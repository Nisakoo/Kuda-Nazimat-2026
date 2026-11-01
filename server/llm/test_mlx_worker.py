"""Unit tests use fake MLX modules; no model, network, or Apple GPU is used."""
import json
import struct
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import mlx_worker as worker
from local_common import WorkerError


class HFTokenizer:
    def __init__(self):
        self.encodes = []
        self.templates = []

    def encode(self, prompt, add_special_tokens=False):
        self.encodes.append((prompt, add_special_tokens))
        return [5, 6, 7]

    def apply_chat_template(self, messages, **kwargs):
        self.templates.append((messages, kwargs))
        return 'rendered prompt'


class Tokenizer:
    # Like mlx-lm's TokenizerWrapper: attribute forwarding is not __call__.
    def __init__(self):
        self._tokenizer = HFTokenizer()

    def __getattr__(self, name):
        return getattr(self._tokenizer, name)

    def apply_chat_template(self, *args, **kwargs):
        return self._tokenizer.apply_chat_template(*args, **kwargs)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = {'model_type': 'qwen3_5', 'quantization': {'bits': 4, 'group_size': 64}}
        (self.root / 'config.json').write_text(json.dumps(self.config))
        header = json.dumps({'model.layers.0.weight': {}}).encode()
        (self.root / 'model.safetensors').write_bytes(struct.pack('<Q', len(header)) + header)
        self.options = {'modelDir': str(self.root), 'modelManifest': str(self.root / 'manifest.json'),
                        'runnerVersion': '0.32.2'}
        self.calls = []
        self.tok = Tokenizer()
        def load(path, tokenizer_config=None, lazy=False, trust_remote_code=False):
            self.calls.append(('load', path, tokenizer_config, lazy, trust_remote_code))
            return object(), self.tok
        def generate(model, tokenizer, prompt, verbose=False, **kwargs):
            self.calls.append(('generate', prompt, kwargs))
            return 'Ответ'
        def stream(model, tokenizer, prompt, max_tokens=256, **kwargs): pass
        def step(prompt, model, stream=None, max_tokens=256, sampler=None, logits_processors=None): pass
        def sampler(temp=0, top_p=0, top_k=0):
            self.calls.append(('sampler', temp, top_p, top_k))
            return 'sampler'
        def processors(repetition_penalty=None, presence_penalty=None, repetition_context_size=20, presence_context_size=20):
            self.calls.append(('processors', repetition_penalty, presence_penalty, repetition_context_size, presence_context_size))
            return ['processor']
        mlx = types.ModuleType('mlx_lm')
        mlx.load, mlx.generate = load, generate
        gen = types.ModuleType('mlx_lm.generate')
        gen.stream_generate, gen.generate_step = stream, step
        sample = types.ModuleType('mlx_lm.sample_utils')
        sample.make_sampler, sample.make_logits_processors = sampler, processors
        for p in (patch.dict(sys.modules, {'mlx_lm': mlx, 'mlx_lm.generate': gen, 'mlx_lm.sample_utils': sample}),
                  patch.object(worker.platform, 'system', return_value='Darwin'),
                  patch.object(worker.platform, 'machine', return_value='arm64'),
                  patch.object(worker.importlib.metadata, 'version', return_value='0.32.2'),
                  patch.object(worker, 'verify_manifest')):
            p.start()
            self.addCleanup(p.stop)

    def test_load_warm_and_exact_tokens(self):
        runtime = worker.Runtime(self.options)
        with patch.object(worker, 'compile_prompt', return_value='exact prompt') as compile_mock:
            self.assertEqual(runtime.answer({'question': 'x'}), 'Ответ')
        compile_mock.assert_called_once_with({'question': 'x'}, self.tok)
        self.assertEqual(self.calls[0], ('sampler', 1.0, 1.0, 20))
        self.assertEqual(self.calls[1], ('processors', 1.0, 2.0, 2048, 2048))
        self.assertEqual(self.calls[2][2:], ({'trust_remote_code': False}, False, False))
        self.assertEqual(self.calls[3][1:], ([5, 6, 7], {'max_tokens': 1, 'sampler': 'sampler', 'logits_processors': ['processor']}))
        self.assertEqual(self.calls[4][1:], ([5, 6, 7], {'max_tokens': 128, 'sampler': 'sampler', 'logits_processors': ['processor']}))

    def test_real_common_prompt_with_noncallable_wrapper(self):
        runtime = worker.Runtime(self.options)
        self.assertFalse(callable(self.tok))
        self.assertEqual(self.tok._tokenizer.encodes,
                         [('rendered prompt', False), ('rendered prompt', False)])
        self.assertEqual(self.calls[-1][1], [5, 6, 7])
        self.tok._tokenizer.encodes.clear()
        self.tok._tokenizer.templates.clear()
        request = {'question': 'Привет?', 'locale': 'ru', 'history': [],
                   'npc': {'name': 'Н', 'topic': 'Т', 'persona': 'П', 'greeting': 'З'}}
        self.assertEqual(runtime.answer(request), 'Ответ')
        self.assertEqual(self.tok._tokenizer.encodes,
                         [('rendered prompt', False), ('rendered prompt', False)])
        _, kwargs = self.tok._tokenizer.templates[0]
        self.assertEqual(kwargs, {'tokenize': False, 'add_generation_prompt': True,
                                  'enable_thinking': False})
        self.assertEqual(self.calls[-1][1], [5, 6, 7])

    def test_broken_template_fails_before_ready(self):
        self.tok.apply_chat_template = lambda *args, **kwargs: (_ for _ in ()).throw(ValueError('broken template'))
        messages = iter([{'op': 'start', 'options': self.options}])
        out = []
        with patch.object(worker, 'read_message', side_effect=lambda: next(messages)), patch.object(worker, 'emit', side_effect=out.append):
            worker.main()
        self.assertEqual(out, [{'type': 'error', 'code': 'model_unavailable', 'message': 'MLX worker failed'}])
        self.assertFalse(any(call[0] == 'generate' for call in self.calls))

    def test_bad_platform_version_and_manifest(self):
        with patch.object(worker.platform, 'system', return_value='Linux'):
            with self.assertRaises(WorkerError): worker.Runtime(self.options)
        with self.assertRaises(WorkerError): worker.Runtime({**self.options, 'runnerVersion': '0.32.1'})
        with patch.object(worker, 'verify_manifest', side_effect=WorkerError('model_unavailable', 'bad')):
            with self.assertRaises(WorkerError): worker.Runtime(self.options)
        self.assertFalse(self.calls)

    def test_reject_vlm_quant_and_tensor(self):
        for update in ({'vision_config': {}}, {'quantization': {'bits': 8, 'group_size': 64}},
                       {'model_type': 'other'}):
            (self.root / 'config.json').write_text(json.dumps({**self.config, **update}))
            with self.assertRaises(WorkerError): worker.Runtime(self.options)
        (self.root / 'config.json').write_text(json.dumps(self.config))
        header = json.dumps({'model.visual.weight': {}}).encode()
        (self.root / 'model.safetensors').write_bytes(struct.pack('<Q', len(header)) + header)
        with self.assertRaises(WorkerError): worker.Runtime(self.options)
        self.assertFalse(self.calls)

    def test_overlong_and_thinking_rejected(self):
        runtime = worker.Runtime(self.options)
        runtime.tokenizer = types.SimpleNamespace(encode=lambda *a, **kw: [1] * 1793)
        with patch.object(worker, 'compile_prompt', return_value='p'):
            with self.assertRaises(WorkerError) as error: runtime.answer({})
        self.assertEqual(error.exception.code, 'input_too_long')
        runtime.tokenizer = self.tok
        runtime.generate = lambda *a, **kw: '<think>secret</think>'
        with patch.object(worker, 'compile_prompt', return_value='p'):
            with self.assertRaises(WorkerError): runtime.answer({})

    def test_protocol_and_safe_failure(self):
        messages = iter([{'op': 'start', 'options': self.options}, {'op': 'answer', 'request': {}}, {'op': 'stop'}])
        out = []
        with patch.object(worker, 'read_message', side_effect=lambda: next(messages)), patch.object(worker, 'emit', side_effect=out.append), patch.object(worker, 'compile_prompt', return_value='p'):
            worker.main()
        self.assertEqual(out, [{'type': 'ready'}, {'type': 'answer', 'text': 'Ответ'}])
        out.clear()
        with patch.object(worker, 'read_message', return_value={'op': 'start', 'options': self.options}), patch.object(worker, 'emit', side_effect=out.append), patch.object(worker, 'Runtime', side_effect=Exception('private')):
            worker.main()
        self.assertEqual(out, [{'type': 'error', 'code': 'model_unavailable', 'message': 'MLX worker failed'}])


if __name__ == '__main__':
    unittest.main()
