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
            data = json.dumps({'config': entries[0], 'layers': [entries[1]]}).encode()
            manifest_path.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            worker.verify_ollama_model(root, digest)
            worker.verify_ollama_model(root, 'sha256:' + digest)
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
            with mock.patch.object(worker, 'verify_manifest'), mock.patch.object(worker, 'verify_ollama_model'), \
                 mock.patch.object(worker.importlib.metadata, 'version', side_effect=['4.57.6', '3.1.6']), \
                 mock.patch.dict(sys.modules, {'transformers': fake_transformers}), \
                 mock.patch.object(worker, 'port_free', return_value=True), mock.patch.object(worker, 'owned_listener', return_value=True), \
                 mock.patch.object(worker.subprocess, 'Popen', return_value=child), \
                 mock.patch.object(instance, 'http', side_effect=[{'version': '1'}, {'models': [{'name': worker.MODEL, 'digest': 'sha256:' + 'a' * 64}]}]), \
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

    def test_dependency_and_template_failure_before_spawn(self):
        opts = {'python': '/python', 'executable': '/ollama', 'modelsDir': '/models', 'tokenizerDir': '/tokenizer',
                'tokenizerManifest': '/manifest', 'model': worker.MODEL, 'modelDigest': 'abc',
                'runnerVersion': '1', 'startupTimeoutMs': 1000, 'threads': 1}
        fake_transformers = mock.Mock()
        fake_transformers.AutoTokenizer.from_pretrained.return_value.apply_chat_template.side_effect = ValueError('bad template')
        with mock.patch.object(worker, 'verify_manifest'), mock.patch.object(worker, 'verify_ollama_model'), \
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
        with mock.patch.object(worker, 'verify_manifest'), mock.patch.object(worker, 'verify_ollama_model'), \
             mock.patch.object(worker.importlib.metadata, 'version', side_effect=['4.57.6', '3.1.6']), \
             mock.patch.dict(sys.modules, {'transformers': fake_transformers}), \
             mock.patch.object(worker, 'port_free', return_value=False), mock.patch.object(worker.subprocess, 'Popen') as popen:
            with self.assertRaises(common.WorkerError): worker.OllamaWorker(opts).start()
            popen.assert_not_called()


if __name__ == '__main__': unittest.main()
