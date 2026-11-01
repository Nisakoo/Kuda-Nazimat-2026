"""Explicit model selection with tiny local metadata/blobs and mocked inference."""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

import local_common as common
import ollama_worker as worker
from test_ollama_worker import ModelFixture, Tokenizer, request


MODELS = (worker.MODEL, 'qwen3.5:0.8b-q8_0')
INVALID_MODELS = (None, False, 8, [], {}, '', 'qwen3.5', 'qwen3.5:latest',
                  'qwen3.5:0.8b', 'qwen3.5:2b', 'qwen3.5:0.8b-cloud',
                  'qwen3.5:0.8b-mtp-q8_0', 'qwen3.5:0.8b-q4_K_M',
                  'qwen3.5:0.8b-q8_0-cloud', 'qwen3.5:0.8b-q8_0 ',
                  'Qwen3.5:0.8b-q8_0', 'ollama.com/library/qwen3.5:0.8b-q8_0',
                  '../2b-q4_K_M', 'qwen3.5:../../2b-q4_K_M', '/tmp/model',
                  'qwen3.5:0.8b-q8_0/../../2b-q4_K_M')


class ModelSelectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.fixtures = {}
        self.active = {}
        self.legacy = {}
        for model in MODELS:
            fixture = ModelFixture(self.root, model)
            # Separate inventories and hashes ensure the other model cannot
            # accidentally satisfy the selected name's pin.
            fixture.manifest['config'] = fixture.blob(model.encode(), 'application/vnd.docker.container.image.v1+json')
            self.fixtures[model] = fixture
            self.active[model] = fixture.write_active()
            self.legacy[model] = fixture.write_legacy()
            tokenizer = self.root / ('tokenizer-' + model.split(':')[1])
            tokenizer.mkdir()
            data = model.encode()
            (tokenizer / 'tokenizer.json').write_bytes(data)
            (self.root / (tokenizer.name + '.json')).write_text(json.dumps({
                'tokenizer.json': hashlib.sha256(data).hexdigest()}))
        self.assertNotEqual(*self.active.values())
        self.assertNotEqual(*self.legacy.values())

    def options(self, model):
        tokenizer = self.root / ('tokenizer-' + model.split(':')[1])
        return {'python': '/fixture/python', 'executable': '/fixture/ollama',
                'modelsDir': str(self.root), 'tokenizerDir': str(tokenizer),
                'tokenizerManifest': str(self.root / (tokenizer.name + '.json')),
                'model': model, 'modelDigest': self.active[model],
                'runnerVersion': 'fixture', 'startupTimeoutMs': 1000, 'threads': 2, 'numGpu': 0}

    def reject_manifest(self, model, pin):
        with self.assertRaises(common.WorkerError) as error:
            worker.verify_ollama_model(self.root, pin, model)
        self.assertEqual(error.exception.code, 'model_unavailable')

    @contextmanager
    def startup(self, options, tags=None):
        """Run real startup and verification, but never spawn or run a model."""
        instance = worker.OllamaWorker(options)
        child = mock.Mock(pid=42)
        child.poll.return_value = None
        fake = mock.Mock()
        fake.AutoTokenizer.from_pretrained.return_value = Tokenizer()
        payloads = []
        if tags is None:
            tags = [{'name': model, 'digest': 'sha256:' + self.active[model]} for model in MODELS]

        def http(path, payload=None, **kwargs):
            if path == '/api/version':
                return {'version': 'fixture'}
            if path == '/api/tags':
                return {'models': tags}
            self.assertEqual(path, '/api/generate')
            payloads.append(payload)
            return json.dumps({'done': True, 'response': 'answer',
                               'prompt_eval_count': len(payload['prompt'])}).encode()

        with mock.patch.object(worker.importlib.metadata, 'version', side_effect=['4.57.6', '3.1.6']), \
             mock.patch.dict(sys.modules, {'transformers': fake}), \
             mock.patch.object(worker, 'port_free', return_value=True), \
             mock.patch.object(worker, 'owned_listener', return_value=True), \
             mock.patch.object(worker.subprocess, 'Popen', return_value=child) as spawn, \
             mock.patch.object(instance, 'http', side_effect=http), \
             mock.patch.object(worker, 'verify_ollama_model', wraps=worker.verify_ollama_model) as verify:
            try:
                yield instance, payloads, spawn, verify, fake
            finally:
                instance.stop()

    def test_allowlist_has_only_two_exact_literals_and_default_stays_2b(self):
        self.assertEqual(worker.MODEL, 'qwen3.5:2b-q4_K_M')
        self.assertEqual(worker.ALLOWED_MODELS, frozenset(MODELS))
        self.assertEqual(worker.verify_ollama_model(self.root, self.active[worker.MODEL]), self.active[worker.MODEL])

    def test_both_selected_active_and_legacy_anchor_pins_with_both_inventories(self):
        for model in MODELS:
            for pin in (self.active[model], self.legacy[model]):
                with self.subTest(model=model, pin=pin):
                    self.assertEqual(worker.verify_ollama_model(self.root, pin, model), self.active[model])
            other = next(value for value in MODELS if value != model)
            for wrong in (self.active[other], self.legacy[other]):
                self.reject_manifest(model, wrong)

    def test_legacy_only_selects_exact_tag_with_both_inventories(self):
        for fixture in self.fixtures.values():
            fixture.active.unlink()
        pins = {model: fixture.write_legacy(anchor=False) for model, fixture in self.fixtures.items()}
        for model in MODELS:
            with self.subTest(model=model):
                self.assertEqual(worker.verify_ollama_model(self.root, pins[model], model), pins[model])
                other = next(value for value in MODELS if value != model)
                self.reject_manifest(model, pins[other])

    def test_missing_selected_model_does_not_use_other_inventory(self):
        for model in MODELS:
            with self.subTest(model=model):
                fixture = self.fixtures[model]
                fixture.active.unlink()
                fixture.legacy.unlink()
                other = next(value for value in MODELS if value != model)
                self.reject_manifest(model, self.active[other])
                with self.startup(self.options(model)) as (instance, payloads, spawn, _, _):
                    with self.assertRaises(common.WorkerError):
                        instance.start()
                    spawn.assert_not_called()
                    self.assertEqual(payloads, [])
                fixture.write_active()
                fixture.write_legacy()

    def test_selected_invalid_v2_never_downgrades_or_uses_other_model(self):
        for model in MODELS:
            with self.subTest(model=model):
                fixture = self.fixtures[model]
                pin = fixture.write_legacy(anchor=False)
                fixture.active.unlink()
                fixture.active.symlink_to(fixture.blobs / ('sha256-' + '0' * 64))
                self.reject_manifest(model, pin)
                fixture.write_active()
                fixture.write_legacy()

    def test_other_tag_legacy_anchor_cannot_authorize_selected_active(self):
        for model in MODELS:
            with self.subTest(model=model):
                fixture = self.fixtures[model]
                other = self.fixtures[next(value for value in MODELS if value != model)]
                fixture.legacy.write_bytes(other.legacy.read_bytes())
                self.reject_manifest(model, self.legacy[next(value for value in MODELS if value != model)])
                fixture.write_legacy()
                original = dict(fixture.active_entry)
                fixture.active_entry = other.active_entry
                self.reject_manifest(model, fixture.write_legacy())
                fixture.active_entry = original
                fixture.write_legacy()

    def test_startup_uses_selected_tag_verified_active_sha_and_explicit_tokenizer(self):
        for model in MODELS:
            for pin in (self.active[model], self.legacy[model]):
                options = dict(self.options(model), modelDigest=pin)
                with self.subTest(model=model, pin=pin), self.startup(options) as (instance, payloads, spawn, verify, fake):
                    instance.start()
                    self.assertIsNone(instance.stage)
                    self.assertEqual(instance.model_digest, self.active[model])
                    verify.assert_called_once_with(str(self.root), pin, model)
                    fake.AutoTokenizer.from_pretrained.assert_called_once_with(
                        options['tokenizerDir'], local_files_only=True, trust_remote_code=False)
                    self.assertEqual(len(payloads), 4)  # Warmup + 3 calibration probes.
                    with mock.patch.object(worker, 'emit'):
                        self.assertEqual(instance.answer(request()), 'answer')
                    self.assertEqual([payload['options']['num_predict'] for payload in payloads], [0, 1, 1, 1, 128])
                    self.assertTrue(all(payload['model'] == model for payload in payloads))
                    self.assertTrue(all(payload['think'] is False for payload in payloads))
                    expected_options = {
                        'num_ctx': 2048, 'num_predict': 128, 'num_thread': 2, 'num_gpu': 0,
                        'temperature': 1.0, 'top_p': 1.0, 'top_k': 20,
                        'presence_penalty': 2.0, 'repeat_penalty': 1.0}
                    if model == worker.SMALL_MODEL:
                        expected_options['draft_num_predict'] = 0
                        self.assertTrue(all(payload['options']['draft_num_predict'] == 0 for payload in payloads))
                    else:
                        self.assertTrue(all('draft_num_predict' not in payload['options'] for payload in payloads))
                    self.assertEqual(payloads[-1]['options'], expected_options)
                    self.assertEqual(spawn.call_args.kwargs['env']['OLLAMA_MAX_LOADED_MODELS'], '1')
                    self.assertEqual(spawn.call_args.args[0], ['/fixture/ollama', 'serve'])

    def test_small_profile_rejects_draft_layers_with_valid_pins_before_spawn(self):
        model = worker.SMALL_MODEL
        fixture = self.fixtures[model]
        original = json.loads(json.dumps(fixture.manifest))
        for media_type in ('application/vnd.ollama.image.draft',
                           'application/vnd.ollama.image.draft.0',
                           'application/vnd.ollama.image.draft.shard',
                           'application/vnd.ollama.image.draft-shard'):
            for layout in ('active-pin', 'anchor-pin', 'legacy-only'):
                with self.subTest(media_type=media_type, layout=layout):
                    fixture.manifest = dict(original, layers=[*original['layers'], fixture.blob(b'tiny draft', media_type)])
                    active = fixture.write_active()
                    anchor = fixture.write_legacy()
                    if layout == 'legacy-only':
                        fixture.active.unlink()
                        pin = fixture.write_legacy(anchor=False)
                    else:
                        pin = active if layout == 'active-pin' else anchor
                    self.reject_manifest(model, pin)
                    options = dict(self.options(model), modelDigest=pin)
                    with self.startup(options) as (instance, payloads, spawn, _, fake):
                        with self.assertRaises(common.WorkerError) as error:
                            instance.start()
                        self.assertEqual(error.exception.code, 'model_unavailable')
                        self.assertEqual(instance.stage, 'ollama_model_integrity')
                        self.assertEqual(payloads, [])
                        spawn.assert_not_called()
                        fake.AutoTokenizer.from_pretrained.assert_not_called()
        fixture.manifest = original
        fixture.write_active()
        fixture.write_legacy()

    def test_draft_guard_does_not_change_2b_manifest_rules(self):
        fixture = self.fixtures[worker.MODEL]
        fixture.manifest['layers'].append(fixture.blob(b'tiny draft', 'application/vnd.ollama.image.draft'))
        active = fixture.write_active()
        anchor = fixture.write_legacy()
        self.assertEqual(worker.verify_ollama_model(self.root, active), active)
        self.assertEqual(worker.verify_ollama_model(self.root, anchor), active)

    def test_tags_must_match_selected_name_and_active_not_anchor_or_other_digest(self):
        for model in MODELS:
            other = next(value for value in MODELS if value != model)
            cases = [[], [{'name': other, 'digest': 'sha256:' + self.active[model]}],
                     [{'name': model, 'digest': 'sha256:' + self.active[other]}],
                     [{'name': model, 'digest': 'sha256:' + self.legacy[model]}],
                     [{'name': model + '-cloud', 'digest': 'sha256:' + self.active[model]}]]
            for tags in cases:
                with self.subTest(model=model, tags=tags), self.startup(self.options(model), tags) as (instance, payloads, _, _, _):
                    with self.assertRaises(common.WorkerError) as error:
                        instance.start()
                    self.assertEqual(error.exception.code, 'model_unavailable')
                    self.assertEqual(instance.stage, 'ollama_model_digest')
                    self.assertEqual(payloads, [])

    def test_invalid_models_fail_before_paths_dependencies_or_inference(self):
        for model in INVALID_MODELS:
            with self.subTest(model=model), mock.patch.object(Path, 'resolve') as resolve:
                self.reject_manifest(model, self.active[worker.MODEL])
                resolve.assert_not_called()
            options = dict(self.options(worker.MODEL), model=model)
            with self.subTest(model=model), mock.patch.object(worker, 'configure_offline') as offline, \
                 mock.patch.object(worker.subprocess, 'Popen') as spawn:
                instance = worker.OllamaWorker(options)
                with self.assertRaises(common.WorkerError) as error:
                    instance.start()
                self.assertEqual(error.exception.code, 'invalid_config')
                self.assertEqual(instance.stage, 'ollama_options')
                offline.assert_not_called()
                spawn.assert_not_called()
                with mock.patch.object(instance, 'http') as http:
                    with self.assertRaises(common.WorkerError):
                        instance.generate('prompt', 128)
                    http.assert_not_called()

    def test_missing_model_option_has_no_production_default(self):
        options = self.options(worker.MODEL)
        del options['model']
        instance = worker.OllamaWorker(options)
        with mock.patch.object(worker, 'configure_offline') as offline, mock.patch.object(instance, 'http') as http:
            with self.assertRaises(common.WorkerError) as error:
                instance.start()
            self.assertEqual(error.exception.code, 'invalid_config')
            with self.assertRaises(common.WorkerError):
                instance.generate('prompt', 128)
            offline.assert_not_called()
            http.assert_not_called()

    def test_selected_tokenizer_inventory_missing_or_corrupt_fails_before_spawn(self):
        for model in MODELS:
            for mode in ('missing', 'corrupt'):
                options = self.options(model)
                token = Path(options['tokenizerDir']) / 'tokenizer.json'
                original = token.read_bytes()
                if mode == 'missing':
                    token.unlink()
                else:
                    token.write_bytes(b'wrong prepared tokenizer')
                try:
                    with self.subTest(model=model, mode=mode), self.startup(options) as (instance, payloads, spawn, verify, fake):
                        with self.assertRaises(common.WorkerError):
                            instance.start()
                        self.assertEqual(instance.stage, 'ollama_tokenizer_integrity')
                        self.assertEqual(payloads, [])
                        spawn.assert_not_called()
                        verify.assert_not_called()
                        fake.AutoTokenizer.from_pretrained.assert_not_called()
                finally:
                    token.write_bytes(original)


if __name__ == '__main__':
    unittest.main()
