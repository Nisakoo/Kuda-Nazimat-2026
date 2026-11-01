import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

import local_common as common
import ollama_worker as worker


class Tokenizer:
    def __init__(self, limit=10000):
        self.messages = None
        self.limit = limit

    def apply_chat_template(self, messages, **kwargs):
        assert kwargs == {'tokenize': False, 'add_generation_prompt': True, 'enable_thinking': False}
        self.messages = list(messages)
        return '|'.join(x['content'] for x in messages)

    def __call__(self, prompt, add_special_tokens):
        assert not add_special_tokens
        return {'input_ids': list(prompt) if self.limit == 10000 else list(range(self.limit))}


def request():
    return {'locale': 'ru', 'question': 'Почему?', 'npc': {'name': 'Лея', 'topic': 'история',
            'persona': 'спокойно', 'greeting': 'Привет'}, 'history': []}


class CommonTests(unittest.TestCase):
    def test_manifest_inventory_and_symlink(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'data'; root.mkdir()
            (root / 'tokenizer.json').write_bytes(b'test')
            manifest = Path(temp) / 'manifest.json'
            manifest.write_text(json.dumps({'tokenizer.json': hashlib.sha256(b'test').hexdigest()}))
            common.verify_manifest(root, manifest)
            (root / 'extra').write_text('extra')
            with self.assertRaises(common.WorkerError): common.verify_manifest(root, manifest)
            (root / 'extra').unlink()
            (root / 'tokenizer.json').unlink()
            (root / 'tokenizer.json').symlink_to(manifest)
            with self.assertRaises(common.WorkerError): common.verify_manifest(root, manifest)

    def test_prompt_trims_oldest_and_rejects_oversize(self):
        req = request()
        req['history'] = [{'question': 'x' * 1000, 'answer': 'y' * 1000}, {'question': 'new', 'answer': 'answer'}]
        tok = Tokenizer()
        prompt = common.compile_prompt(req, tok)
        self.assertNotIn('x' * 100, prompt)
        self.assertIn('new', prompt)
        self.assertEqual(tok.messages[-1]['content'], 'Почему?')
        with self.assertRaises(common.WorkerError) as err: common.compile_prompt(req, Tokenizer(1793))
        self.assertEqual(err.exception.code, 'input_too_long')
        req['question'] = 'x' * 241
        with self.assertRaises(common.WorkerError): common.compile_prompt(req, tok)

    def test_noncallable_tokenizer_wrapper(self):
        class Wrapper:
            def apply_chat_template(self, messages, **kwargs):
                self.messages = messages
                self.template_options = kwargs
                return 'rendered prompt'

            def encode(self, prompt, **kwargs):
                self.encoded = (prompt, kwargs)
                return [1, 2, 3]

        tokenizer = Wrapper()
        self.assertEqual(common.compile_prompt(request(), tokenizer), 'rendered prompt')
        self.assertEqual(tokenizer.encoded, ('rendered prompt', {'add_special_tokens': False}))
        self.assertFalse(tokenizer.template_options['enable_thinking'])

    def test_normalize(self):
        self.assertEqual(common.normalize_text(' a\r\nb\x00 '), 'a\nb')
        self.assertEqual(len(common.normalize_text('x' * 5000)), 4000)
        for text in ('<think>secret</think>', 'x' * 16385, '  '):
            with self.assertRaises(common.WorkerError): common.normalize_text(text)

    def test_ipc_limits(self):
        stdin = mock.Mock(buffer=io.BytesIO(b'{"op":"stop"}\n'))
        with mock.patch.object(sys, 'stdin', stdin): self.assertEqual(common.read_message(), {'op': 'stop'})
        with mock.patch.object(sys, 'stdin', mock.Mock(buffer=io.BytesIO(b'x' * 65537))):
            with self.assertRaises(common.WorkerError): common.read_message()


class ModelFixture:
    """Small local Docker manifests; no real weights or daemon."""
    def __init__(self, root):
        self.root = Path(root)
        self.blobs = self.root / 'blobs'
        self.blobs.mkdir()
        self.legacy = self.root / 'manifests/registry.ollama.ai/library/qwen3.5/2b-q4_K_M'
        self.active = self.root / 'manifests-v2/ollama.com/library/qwen3.5/2b-q4_K_M'
        self.legacy.parent.mkdir(parents=True)
        self.active.parent.mkdir(parents=True)
        self.manifest = {'schemaVersion': 2, 'mediaType': worker.MANIFEST_TYPE,
                         'runner': 'llamacpp', 'format': 'gguf',
                         'config': self.blob(b'config', 'application/vnd.docker.container.image.v1+json'),
                         'layers': [self.blob(kind.encode(), 'application/vnd.ollama.image.' + kind)
                                    for kind in ('projector', 'model', 'template', 'license', 'params')]}

    def blob(self, content, media_type):
        digest = hashlib.sha256(content).hexdigest()
        (self.blobs / ('sha256-' + digest)).write_bytes(content)
        return {'mediaType': media_type, 'digest': 'sha256:' + digest, 'size': len(content)}

    def write_active(self, manifest=None, symlink=True, raw=None):
        data = raw if raw is not None else json.dumps(manifest or self.manifest).encode()
        self.active_entry = self.blob(data, worker.MANIFEST_TYPE)
        if os.path.lexists(self.active):
            self.active.unlink()
        if symlink:
            target = self.blobs / self.active_entry['digest'].replace(':', '-')
            self.active.symlink_to(os.path.relpath(target, self.active.parent))
        else:
            self.active.write_bytes(data)
        return self.active_entry['digest'][7:]

    def write_legacy(self, anchor=True, manifest=None, raw=None):
        value = dict(manifest or self.manifest)
        value['layers'] = list(value['layers'])
        if anchor:
            value['layers'].append(dict(self.active_entry))
        data = raw if raw is not None else json.dumps(value).encode()
        self.legacy.write_bytes(data)
        return hashlib.sha256(data).hexdigest()


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.f = ModelFixture(self.temp.name)

    def reject(self, pin):
        with self.assertRaises(common.WorkerError) as error:
            worker.verify_ollama_model(self.f.root, pin)
        self.assertEqual(error.exception.code, 'model_unavailable')
        self.assertEqual(str(error.exception), 'Ollama model verification failed')

    def test_real_case_metadata_hashes_and_binding_only(self):
        # Metadata only: this does NOT validate or pretend to load real blobs.
        data = Path(__file__).with_name('fixtures').joinpath('qwen35-2b-active-manifest.json').read_bytes()
        active_digest = '1e2d21a4f03ab9e4a9c1976a4b7e88f21de61d65f2c5485d8fde8942be73f1e7'
        legacy_digest = '2fcba4e039b23928e05c8554adc262dbf5652d70bb20a36c947db9272c38c1dc'
        self.assertEqual(len(data), 1088)
        self.assertEqual(hashlib.sha256(data).hexdigest(), active_digest)
        active = json.loads(data, object_pairs_hook=common._unique_pairs)
        legacy = dict(active, layers=[*active['layers'], {'mediaType': worker.MANIFEST_TYPE,
                                                       'digest': 'sha256:' + active_digest, 'size': len(data)}])
        legacy_data = json.dumps(legacy, separators=(',', ':')).encode()
        self.assertEqual(len(legacy_data), 1252)
        self.assertEqual(hashlib.sha256(legacy_data).hexdigest(), legacy_digest)
        self.assertTrue(worker._legacy_anchor_matches(active, active_digest, len(data), legacy))
        self.assertFalse(worker._legacy_anchor_matches(active, '0' * 64, len(data), legacy))

    def test_legacy_only_pin_and_mismatch(self):
        pin = self.f.write_legacy(anchor=False)
        self.assertEqual(worker.verify_ollama_model(self.f.root, pin), pin)
        self.reject('0' * 64)

    def test_v2_active_pin_regular_and_relative_or_absolute_link(self):
        for mode in ('regular', 'relative', 'absolute'):
            with self.subTest(mode=mode):
                pin = self.f.write_active(symlink=mode != 'regular')
                if mode == 'absolute':
                    self.f.active.unlink()
                    self.f.active.symlink_to(self.f.blobs / ('sha256-' + pin))
                # An active pin does not require a trustworthy legacy artifact.
                self.f.legacy.write_bytes(b'invalid legacy')
                self.assertEqual(worker.verify_ollama_model(self.f.root, 'sha256:' + pin.upper()), pin)

    def test_legacy_anchor_keeps_original_pin(self):
        for symlink in (False, True):
            with self.subTest(symlink=symlink):
                active = self.f.write_active(symlink=symlink)
                pin = self.f.write_legacy()
                self.assertNotEqual(pin, active)
                self.assertEqual(worker.verify_ollama_model(self.f.root, pin), active)

    def test_v2_does_not_fall_back_to_valid_legacy(self):
        pin = self.f.write_legacy(anchor=False, raw=json.dumps(self.f.manifest).encode() + b'\n')
        self.f.write_active()
        self.reject(pin)  # Same payload is not enough without the direct link.
        self.reject('0' * 64)
        self.f.active.unlink()
        self.f.active.symlink_to(self.f.blobs / ('sha256-' + '0' * 64))
        self.reject(pin)  # A dangling v2 name is present, not legacy fallback.

    def test_anchor_does_not_approve_different_payload(self):
        for field in ('config', 'model', 'projector', 'template', 'params', 'runner', 'format'):
            with self.subTest(field=field):
                changed = json.loads(json.dumps(self.f.manifest))
                if field == 'config':
                    changed[field] = self.f.blob(b'changed config', changed[field]['mediaType'])
                elif field in ('runner', 'format'):
                    changed[field] = 'different'
                else:
                    index = next(i for i, e in enumerate(changed['layers']) if e['mediaType'].endswith('.' + field))
                    changed['layers'][index] = self.f.blob(b'changed ' + field.encode(), changed['layers'][index]['mediaType'])
                self.f.write_active(manifest=changed)
                pin = self.f.write_legacy()
                self.reject(pin)

    def test_unrelated_anchor_and_wrong_anchor_media_type(self):
        self.f.write_active()
        original = dict(self.f.active_entry)
        self.f.active_entry = self.f.blob(b'unrelated artifact', worker.MANIFEST_TYPE)
        self.reject(self.f.write_legacy())
        self.f.active_entry = dict(original, mediaType='application/vnd.ollama.image.template')
        self.reject(self.f.write_legacy())

    def test_anchor_legacy_hash_and_every_blob_size_and_hash(self):
        active = self.f.write_active()
        pin = self.f.write_legacy()
        self.f.legacy.write_bytes(self.f.legacy.read_bytes() + b' ')
        self.reject(pin)
        for entry in [self.f.manifest['config'], *self.f.manifest['layers'], self.f.active_entry]:
            path = self.f.blobs / entry['digest'].replace(':', '-')
            original = path.read_bytes()
            for data in (b'x' * len(original), original + b'x', original[:-1]):
                with self.subTest(entry=entry['mediaType'], size=len(data)):
                    self.f.write_legacy()
                    path.write_bytes(data)
                    self.reject(pin)
                    path.write_bytes(original)
        self.assertEqual(worker.verify_ollama_model(self.f.root, pin), active)
        # A wrong anchor descriptor size fails even though its hash is correct.
        self.f.active_entry['size'] += 1
        self.reject(self.f.write_legacy())

    def test_extra_unrelated_or_duplicate_legacy_anchor_is_rejected(self):
        self.f.write_active()
        unrelated = self.f.blob(b'extra anchor', worker.MANIFEST_TYPE)
        for extra in (unrelated, dict(self.f.active_entry)):
            with self.subTest(extra=extra['digest']):
                # Every blob is valid, but only one direct anchor is supported.
                legacy = dict(self.f.manifest, layers=[*self.f.manifest['layers'], extra])
                self.reject(self.f.write_legacy(manifest=legacy))

    def test_indirect_legacy_anchor_graph_is_rejected(self):
        self.f.write_active()
        child = dict(self.f.manifest, layers=[*self.f.manifest['layers'], self.f.active_entry])
        self.f.active_entry = self.f.blob(json.dumps(child).encode(), worker.MANIFEST_TYPE)
        self.reject(self.f.write_legacy())

    def test_manifest_reference_layers_cannot_be_active_with_any_pin(self):
        for media_type in worker.MANIFEST_REFERENCE_TYPES:
            with self.subTest(media_type=media_type):
                child = self.f.blob(json.dumps(self.f.manifest).encode(), media_type)
                manifest = dict(self.f.manifest, layers=[*self.f.manifest['layers'], child])
                pin = self.f.write_active(manifest=manifest)
                self.reject(pin)  # Direct active pin cannot approve a reference layer.
                legacy_pin = self.f.write_legacy(manifest=manifest)
                self.reject(legacy_pin)  # Nor can legacy compatibility approve it.
                self.f.active.unlink()
                legacy_pin = self.f.write_legacy(anchor=False, manifest=manifest)
                self.reject(legacy_pin)  # An anchor is not a legacy-only runnable artifact.

    def test_schema_version_must_be_integer_two(self):
        for version in (2.0, True, False, '2', None, 1, 3):
            with self.subTest(version=version):
                manifest = dict(self.f.manifest, schemaVersion=version)
                pin = self.f.write_active(manifest=manifest)
                self.reject(pin)
                self.f.active.unlink()
                self.reject(self.f.write_legacy(anchor=False, manifest=manifest))
        # The same check applies to the legacy document used for v2 binding.
        self.f.write_active()
        self.reject(self.f.write_legacy(manifest=dict(self.f.manifest, schemaVersion=2.0)))

    def test_v2_link_filename_hash_mismatch(self):
        self.f.write_active()
        wrong = self.f.blobs / ('sha256-' + '0' * 64)
        wrong.write_bytes(self.f.active.read_bytes())
        self.f.active.unlink()
        self.f.active.symlink_to(wrong)
        self.reject('0' * 64)

    def test_symlink_escape_chain_and_final_blob(self):
        active = self.f.write_active()
        blob = self.f.blobs / ('sha256-' + active)
        outside = self.f.root / ('sha256-' + active)
        outside.write_bytes(blob.read_bytes())
        for target in (outside, self.f.root / 'chain', self.f.blobs / 'not-a-digest'):
            with self.subTest(target=target.name):
                chain = self.f.root / 'chain'
                if not chain.exists():
                    chain.symlink_to(blob)
                self.f.active.unlink()
                self.f.active.symlink_to(target)
                self.reject(active)
        self.f.active.unlink()
        self.f.active.symlink_to(blob)
        blob.unlink()
        blob.symlink_to(outside)
        self.reject(active)

    def test_parent_and_blobs_symlinks(self):
        active = self.f.write_active()
        for path in (self.f.root / 'manifests-v2', self.f.active.parent, self.f.blobs):
            with self.subTest(path=path):
                moved = path.with_name(path.name + '-real')
                path.rename(moved)
                path.symlink_to(moved, target_is_directory=True)
                self.reject(active)
                path.unlink()
                moved.rename(path)
        # Symlink parents are invalid even if the final named v2 path is absent.
        self.f.active.unlink()
        pin = self.f.write_legacy(anchor=False)
        path = self.f.root / 'manifests-v2'
        moved = path.with_name('v2-real')
        path.rename(moved)
        path.symlink_to(moved, target_is_directory=True)
        self.reject(pin)

    def test_legacy_named_and_parent_symlinks(self):
        pin = self.f.write_legacy(anchor=False)
        target = self.f.root / 'legacy-copy'
        target.write_bytes(self.f.legacy.read_bytes())
        self.f.legacy.unlink()
        self.f.legacy.symlink_to(target)
        self.reject(pin)
        self.f.legacy.unlink()
        self.f.write_legacy(anchor=False)
        path = self.f.legacy.parent
        moved = path.with_name('legacy-real')
        path.rename(moved)
        path.symlink_to(moved)
        self.reject(pin)

    def test_reject_lists_references_empty_and_duplicate_json(self):
        bad = [
            {'schemaVersion': 2, 'mediaType': 'application/vnd.ollama.manifest.list.v2+json', 'manifests': []},
            {'schemaVersion': 2, 'mediaType': 'application/vnd.docker.distribution.manifest.list.v2+json', 'manifests': []},
            {'mediaType': worker.MANIFEST_TYPE, 'digest': 'sha256:' + 'a' * 64},
            dict(self.f.manifest, layers=[]),
            dict(self.f.manifest, layers=[self.f.blob(b'arbitrary', 'unknown')]),
            dict(self.f.manifest, manifests=[]),
        ]
        raw = json.dumps(self.f.manifest).encode()
        duplicate_top = raw[:-1] + b',"runner":"llamacpp"}'
        duplicate_nested = raw.replace(b'"size": 6', b'"size": 6, "size": 6', 1)
        for data in [json.dumps(m).encode() for m in bad] + [duplicate_top, duplicate_nested, b' ' * 65537]:
            with self.subTest(data=data[:80]):
                pin = self.f.write_active(raw=data)
                self.reject(pin)
                self.f.active.unlink()
                pin = self.f.write_legacy(anchor=False, raw=data)
                self.reject(pin)

    def test_blob_reads_are_streaming_and_manifest_read_bounded(self):
        large = self.f.blob(b'w' * (2 * 1024 * 1024 + 13), worker.MODEL_TYPE)
        self.f.manifest['layers'][1] = large
        pin = self.f.write_active()
        real_open = Path.open
        reads = []

        def tracking_open(path, *args, **kwargs):
            file = real_open(path, *args, **kwargs)
            wrapped = mock.MagicMock(wraps=file)
            wrapped.__enter__.return_value = wrapped
            wrapped.__exit__.side_effect = lambda *args: file.close()
            wrapped.read.side_effect = lambda size: (reads.append(size), file.read(size))[1]
            return wrapped

        with mock.patch.object(Path, 'open', tracking_open):
            self.assertEqual(worker.verify_ollama_model(self.f.root, pin), pin)
        self.assertEqual(reads[0], worker.WIRE_LIMIT + 1)
        self.assertTrue(all(size == 1024 * 1024 for size in reads[1:]))
        self.assertGreater(reads.count(1024 * 1024), 3)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.w = worker.OllamaWorker({'threads': 2, 'numGpu': 0})

    def test_generation_contract(self):
        with mock.patch.object(self.w, 'http', return_value=b'{"response":"hello","done":false}\n{"done":true}\n') as http:
            self.assertEqual(self.w.generate('prompt', 128), 'hello')
            payload = http.call_args.args[1]
            self.assertTrue(payload['raw']); self.assertFalse(payload['think'])
            self.assertEqual(payload['keep_alive'], -1)
            self.assertEqual(payload['options']['num_ctx'], 2048)
            self.assertEqual(payload['options']['num_predict'], 128)
        with mock.patch.object(self.w, 'http', return_value=b'{"response":"","done":true}\n'):
            self.assertEqual(self.w.generate('', 0, allow_empty=True), '')

    def test_prompt_telemetry_and_empty_probe(self):
        good = b'{"response":"","done":true,"prompt_eval_count":17}\n'
        with mock.patch.object(self.w, 'http', return_value=good) as http:
            self.assertEqual(self.w.generate('probe', 1, allow_empty=True, expected_tokens=17), '')
            self.assertEqual(http.call_args.args[1]['options']['num_predict'], 1)
        for actual in (None, 16, 1793, True, '17', -1):
            terminal = {'response': 'answer', 'done': True}
            if actual is not None:
                terminal['prompt_eval_count'] = actual
            with self.subTest(actual=actual), mock.patch.object(self.w, 'http', return_value=json.dumps(terminal).encode()):
                with self.assertRaises(common.WorkerError) as error:
                    self.w.generate('prompt', 128, expected_tokens=17)
                self.assertEqual(error.exception.diagnostic, 'ollama_token_count_mismatch')
        with mock.patch.object(self.w, 'http') as http:
            with self.assertRaises(common.WorkerError): self.w.generate('prompt', 128, expected_tokens=1793)
            http.assert_not_called()

    def test_answer_requires_count_match(self):
        self.w.tokenizer = Tokenizer()
        prompt = common.compile_prompt(request(), self.w.tokenizer)
        count = common.count_prompt_tokens(prompt, self.w.tokenizer)
        with mock.patch.object(self.w, 'http', return_value=json.dumps({'response': 'ответ', 'done': True, 'prompt_eval_count': count}).encode()):
            self.assertEqual(self.w.answer(request()), 'ответ')
        with mock.patch.object(self.w, 'http', return_value=b'{"response":"answer","done":true}'):
            with self.assertRaises(common.WorkerError): self.w.answer(request())

    def test_bad_streams(self):
        for raw in (b'{"response":"x"}\n', b'{"error":"bad","done":true}\n',
                    b'{"thinking":"secret","done":true}\n', b'{"done":true}\n{"done":true}\n',
                    json.dumps({'response': 'a' * 16385, 'done': True}).encode()):
            with self.subTest(raw=raw[:50]), mock.patch.object(self.w, 'http', return_value=raw):
                with self.assertRaises(common.WorkerError): self.w.generate('x', 128)

    def test_http_refuses_unowned_listener(self):
        self.w.child = mock.Mock(pid=42); self.w.child.poll.return_value = None
        with mock.patch.object(worker, 'owned_listener', return_value=False), mock.patch.object(self.w.opener, 'open') as op:
            with self.assertRaises(common.WorkerError): self.w.http('/api/tags')
            op.assert_not_called()

    def test_model_manifest_and_blobs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest_path = root / 'manifests/registry.ollama.ai/library/qwen3.5/2b-q4_K_M'
            manifest_path.parent.mkdir(parents=True)
            blobs = root / 'blobs'; blobs.mkdir()
            entries = []
            for content in (b'config', b'weights'):
                digest = hashlib.sha256(content).hexdigest()
                (blobs / ('sha256-' + digest)).write_bytes(content)
                entries.append({'digest': 'sha256:' + digest, 'size': len(content)})
            entries[1]['mediaType'] = worker.MODEL_TYPE
            data = json.dumps({'schemaVersion': 2, 'mediaType': worker.MANIFEST_TYPE,
                               'config': entries[0], 'layers': [entries[1]]}).encode()
            manifest_path.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            self.assertEqual(worker.verify_ollama_model(root, digest), digest)
            self.assertEqual(worker.verify_ollama_model(root, 'sha256:' + digest.upper()), digest)
            blob = blobs / ('sha256-' + entries[1]['digest'].removeprefix('sha256:'))
            blob.write_bytes(b'altered')
            with self.assertRaises(common.WorkerError): worker.verify_ollama_model(root, digest)
            blob.unlink()
            blob.symlink_to(manifest_path)
            with self.assertRaises(common.WorkerError): worker.verify_ollama_model(root, digest)
            with self.assertRaises(common.WorkerError): worker.verify_ollama_model(root, '0' * 64)

    def test_http_line_limit(self):
        self.w.child = mock.Mock(pid=42); self.w.child.poll.return_value = None
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'x' * 32769
        with mock.patch.object(worker, 'owned_listener', return_value=True), \
             mock.patch.object(self.w.opener, 'open', return_value=response):
            with self.assertRaises(common.WorkerError) as error: self.w.http('/api/generate', stream=True)
            self.assertEqual(error.exception.code, 'output_limit')

    def test_http_diagnostics_are_bounded_and_private(self):
        self.w.child = mock.Mock(pid=42); self.w.child.poll.return_value = None
        cases = [(b'{"error":"model requires more system memory SECRET"}', 'ollama_memory_insufficient'),
                 (b'{"error":"not enough memory SECRET"}', 'ollama_memory_insufficient'),
                 (b'{"error":"other SECRET"}', 'ollama_runner_rejected'),
                 (b'not json SECRET', 'ollama_runner_rejected')]
        with mock.patch.object(worker, 'owned_listener', return_value=True):
            for body, diagnostic in cases:
                fp = mock.Mock(wraps=io.BytesIO(body))
                exc = worker.urllib.error.HTTPError('http://localhost', 500, 'SECRET', {}, fp)
                with self.subTest(diagnostic=diagnostic), mock.patch.object(self.w.opener, 'open', side_effect=exc):
                    with self.assertRaises(common.WorkerError) as error: self.w.http('/api/tags')
                    self.assertEqual(error.exception.diagnostic, diagnostic)
                    self.assertNotIn('SECRET', str(error.exception))
                    fp.read.assert_called_once_with(32768)
            with mock.patch.object(self.w.opener, 'open', side_effect=worker.urllib.error.URLError('SECRET')):
                with self.assertRaises(common.WorkerError) as error: self.w.http('/api/tags')
                self.assertEqual(error.exception.diagnostic, 'ollama_runner_connection')
            response = mock.MagicMock()
            response.__enter__.return_value.read.return_value = b'not json'
            with mock.patch.object(self.w.opener, 'open', return_value=response):
                with self.assertRaises(common.WorkerError) as error: self.w.http('/api/tags')
                self.assertEqual(error.exception.diagnostic, 'ollama_response_invalid')

    def test_main_startup_stage_and_answer_stage_clear(self):
        stages = ('options tokenizer_integrity model_integrity dependencies tokenizer_load template port '
                  'runtime_directory spawn listener version model_digest warmup calibration').split()
        for stage in stages:
            for generic in (False, True):
                instance = mock.Mock(stage='ollama_' + stage)
                instance.start.side_effect = RuntimeError('SECRET') if generic else common.WorkerError('invalid_config', 'safe')
                messages = [{'op': 'start', 'options': {}}]
                emitted = []
                with self.subTest(stage=stage, generic=generic), \
                     mock.patch.object(worker, 'OllamaWorker', return_value=instance), \
                     mock.patch.object(worker, 'read_message', side_effect=messages), \
                     mock.patch.object(worker, 'emit', side_effect=emitted.append):
                    worker.main()
                    self.assertEqual(emitted[0]['diagnostic'], 'ollama_' + stage)
                    self.assertNotIn('SECRET', json.dumps(emitted))
        instance = mock.Mock(stage='ollama_warmup')
        error = common.WorkerError('model_unavailable', 'Ollama request failed')
        error.diagnostic = 'ollama_memory_insufficient'
        instance.start.side_effect = error
        with mock.patch.object(worker, 'OllamaWorker', return_value=instance), \
             mock.patch.object(worker, 'read_message', return_value={'op': 'start', 'options': {}}), \
             mock.patch.object(worker, 'emit') as emit:
            worker.main()
            self.assertEqual(emit.call_args.args[0], {'type': 'error', 'code': 'model_unavailable',
                                                      'message': 'Ollama request failed',
                                                      'diagnostic': 'ollama_memory_insufficient'})
        instance = mock.Mock(stage='ollama_calibration')
        instance.answer.side_effect = common.WorkerError('invalid_response', 'safe')
        with mock.patch.object(worker, 'OllamaWorker', return_value=instance), \
             mock.patch.object(worker, 'read_message', side_effect=[{'op': 'start', 'options': {}}, {'op': 'answer', 'request': {}}]), \
             mock.patch.object(worker, 'emit') as emit:
            worker.main()
            self.assertEqual(emit.call_args_list[0].args[0], {'type': 'ready'})
            self.assertNotIn('diagnostic', emit.call_args_list[1].args[0])

    def test_stop_owned_child_and_runtime(self):
        self.w.child = mock.Mock(); self.w.child.poll.return_value = None
        child = self.w.child
        self.w.runtime = mock.Mock(); runtime = self.w.runtime
        self.w.stop(); self.w.stop()
        child.terminate.assert_called_once(); child.wait.assert_called_once(); runtime.cleanup.assert_called_once()

    def test_start_calibrates_before_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            opts = {'python': '/python', 'executable': '/ollama', 'modelsDir': temp, 'tokenizerDir': '/tokenizer',
                    'tokenizerManifest': '/manifest', 'model': worker.MODEL, 'modelDigest': 'a' * 64,
                    'runnerVersion': '1', 'startupTimeoutMs': 1000, 'threads': 1}
            fake_transformers = mock.Mock()
            fake_transformers.AutoTokenizer.from_pretrained.return_value = Tokenizer()
            instance = worker.OllamaWorker(opts)
            child = mock.Mock(pid=42); child.poll.return_value = None
            with mock.patch.object(worker, 'verify_manifest'), mock.patch.object(worker, 'verify_ollama_model', return_value='b' * 64), \
                 mock.patch.object(worker.importlib.metadata, 'version', side_effect=['4.57.6', '3.1.6']), \
                 mock.patch.dict(sys.modules, {'transformers': fake_transformers}), \
                 mock.patch.object(worker, 'port_free', return_value=True), mock.patch.object(worker, 'owned_listener', return_value=True), \
                 mock.patch.object(worker.subprocess, 'Popen', return_value=child), \
                 mock.patch.object(instance, 'http', side_effect=[{'version': '1'}, {'models': [{'name': worker.MODEL, 'digest': 'sha256:' + 'b' * 64}]}]), \
                 mock.patch.object(instance, 'generate', return_value='') as generate:
                try:
                    instance.start()
                    self.assertEqual(generate.call_count, 4)
                    self.assertEqual(generate.call_args_list[0].args, ('', 0))
                    for call in generate.call_args_list[1:]:
                        self.assertEqual(call.args[1], 1)
                        self.assertTrue(call.kwargs['allow_empty'])
                        self.assertGreater(call.kwargs['expected_tokens'], 0)
                finally:
                    instance.stop()

    def test_start_rejects_api_legacy_pin_or_unrelated_digest_after_resolution(self):
        for api_digest in ('a' * 64, 'c' * 64):
            with self.subTest(api_digest=api_digest), tempfile.TemporaryDirectory() as temp:
                opts = {'python': '/python', 'executable': '/ollama', 'modelsDir': temp, 'tokenizerDir': '/tokenizer',
                        'tokenizerManifest': '/manifest', 'model': worker.MODEL, 'modelDigest': 'a' * 64,
                        'runnerVersion': '1', 'startupTimeoutMs': 1000, 'threads': 1}
                fake_transformers = mock.Mock()
                fake_transformers.AutoTokenizer.from_pretrained.return_value = Tokenizer()
                instance = worker.OllamaWorker(opts)
                child = mock.Mock(pid=42); child.poll.return_value = None
                with mock.patch.object(worker, 'verify_manifest'), \
                     mock.patch.object(worker, 'verify_ollama_model', return_value='b' * 64), \
                     mock.patch.object(worker.importlib.metadata, 'version', side_effect=['4.57.6', '3.1.6']), \
                     mock.patch.dict(sys.modules, {'transformers': fake_transformers}), \
                     mock.patch.object(worker, 'port_free', return_value=True), \
                     mock.patch.object(worker, 'owned_listener', return_value=True), \
                     mock.patch.object(worker.subprocess, 'Popen', return_value=child), \
                     mock.patch.object(instance, 'http', side_effect=[{'version': '1'}, {'models': [{'name': worker.MODEL, 'digest': api_digest}]}]), \
                     mock.patch.object(instance, 'generate') as generate:
                    try:
                        with self.assertRaises(common.WorkerError): instance.start()
                        self.assertEqual(instance.model_digest, 'b' * 64)
                        self.assertEqual(instance.stage, 'ollama_model_digest')
                        generate.assert_not_called()
                    finally:
                        instance.stop()

    def test_dependency_and_template_failure_before_spawn(self):
        opts = {'python': '/python', 'executable': '/ollama', 'modelsDir': '/models', 'tokenizerDir': '/tokenizer',
                'tokenizerManifest': '/manifest', 'model': worker.MODEL, 'modelDigest': 'abc',
                'runnerVersion': '1', 'startupTimeoutMs': 1000, 'threads': 1}
        fake_transformers = mock.Mock()
        fake_transformers.AutoTokenizer.from_pretrained.return_value.apply_chat_template.side_effect = ValueError('bad template')
        with mock.patch.object(worker, 'verify_manifest'), mock.patch.object(worker, 'verify_ollama_model', return_value='a' * 64), \
             mock.patch.dict(sys.modules, {'transformers': fake_transformers}), \
             mock.patch.object(worker.subprocess, 'Popen') as popen:
            with mock.patch.object(worker.importlib.metadata, 'version', return_value='wrong'):
                with self.assertRaises(common.WorkerError): worker.OllamaWorker(opts).start()
            with mock.patch.object(worker.importlib.metadata, 'version', side_effect=['4.57.6', '3.1.6']):
                with self.assertRaises(ValueError): worker.OllamaWorker(opts).start()
            popen.assert_not_called()

    def test_port_occupied_before_spawn(self):
        opts = {'python': '/python', 'executable': '/ollama', 'modelsDir': '/models', 'tokenizerDir': '/tokenizer',
                'tokenizerManifest': '/manifest', 'model': worker.MODEL, 'modelDigest': 'abc',
                'runnerVersion': '1', 'startupTimeoutMs': 1000, 'threads': 1}
        fake_transformers = mock.Mock()
        fake_transformers.AutoTokenizer.from_pretrained.return_value = Tokenizer()
        with mock.patch.object(worker, 'verify_manifest'), mock.patch.object(worker, 'verify_ollama_model', return_value='a' * 64), \
             mock.patch.object(worker.importlib.metadata, 'version', side_effect=['4.57.6', '3.1.6']), \
             mock.patch.dict(sys.modules, {'transformers': fake_transformers}), \
             mock.patch.object(worker, 'port_free', return_value=False), mock.patch.object(worker.subprocess, 'Popen') as popen:
            with self.assertRaises(common.WorkerError): worker.OllamaWorker(opts).start()
            popen.assert_not_called()


if __name__ == '__main__': unittest.main()
