"""Offline target policy tests; no model or runtime is started."""
import json
import types
import unittest
from unittest.mock import patch

import local_common as common
import mlx_worker
import ollama_worker


class Tokenizer:
    def apply_chat_template(self, messages, **kwargs):
        self.messages = messages
        self.options = kwargs
        return json.dumps(messages, ensure_ascii=False)

    def encode(self, prompt, add_special_tokens=False):
        return list(prompt)


def request(locale='en'):
    return {'locale': locale, 'question': 'привет', 'history': [],
            'npc': {'name': 'Public', 'topic': 'Topic', 'persona': 'Calm', 'greeting': 'Hello'}}


class TargetTests(unittest.TestCase):
    def test_prompt_locales_and_whole_history(self):
        for locale, language in [('en', 'English'), ('es', 'Spanish')]:
            req = request(locale)
            req['history'] = [{'question': 'old' * 700, 'answer': 'old answer'},
                              {'question': 'new', 'answer': 'new answer'}]
            tok = Tokenizer()
            common.compile_prompt(req, tok)
            system = tok.messages[0]['content']
            for value in [language, 'A2', '2–4 short complete sentences', 'emoji', 'untrusted data', 'Public']:
                self.assertIn(value, system)
            self.assertEqual(len(tok.messages), 3)
            self.assertIn('new answer', tok.messages[1]['content'])
            self.assertNotIn('old answer', tok.messages[1]['content'])
            self.assertIn('привет', tok.messages[-1]['content'])
            self.assertFalse(tok.options['enable_thinking'])
            req['npc']['persona'] = 'x' * 1800
            with self.assertRaises(common.WorkerError) as error: common.compile_prompt(req, tok)
            self.assertEqual(error.exception.code, 'input_too_long')

    def test_codepoints_and_invalid_unicode(self):
        tok = Tokenizer()
        for value in ['x' * 800, '𐀀' * 800]:
            req = request(); req['question'] = value
            # Tokenizer simulation counts characters of JSON rendering, which still fits 1792.
            common.compile_prompt(req, tok)
        for value in ['x' * 801, '𐀀' * 801, '\ud800', '\udc00']:
            req = request(); req['question'] = value
            with self.assertRaises(common.WorkerError): common.compile_prompt(req, tok)
        for value in ['x' * 800, '𐀀' * 800, '¡Hola, señor! 25 °C; ∑ 2 + 2 = 4. ؎ ب\u200dب']:
            self.assertEqual(common.normalize_target_text(value), value)
        for value in ['x' * 801, '𐀀' * 801, '\ud800', '\udc00', 'Hello 🙂', 'Hi ☀️', '1️⃣',
                      '1\u20e3', '🇪🇸', '👩\u200d🔬', '🏽', 'text\ufe0f']:
            with self.assertRaises(common.WorkerError): common.normalize_target_text(value)
        self.assertEqual(len(common.normalize_text('x' * 5000)), 4000)

    def test_mlx_only_accepts_explicit_stop(self):
        runtime = object.__new__(mlx_worker.Runtime)
        runtime.tokenizer = Tokenizer(); runtime.model = object(); runtime.sampler = None; runtime.processors = []
        for locale in ('en', 'es'):
            for reason in ('length', None, 'other'):
                runtime.stream_generate = lambda *a, **kw: iter([types.SimpleNamespace(text='Hello', finish_reason=reason)])
                with self.assertRaises(common.WorkerError): runtime.answer(request(locale))
            runtime.stream_generate = lambda *a, **kw: iter([types.SimpleNamespace(text='Hello.', finish_reason='stop')])
            self.assertEqual(runtime.answer(request(locale)), 'Hello.')
            for text in ('Hello 🙂', 'x' * 801, '\ud800'):
                runtime.stream_generate = lambda *a, **kw: iter([types.SimpleNamespace(text=text, finish_reason='stop')])
                with self.assertRaises(common.WorkerError): runtime.answer(request(locale))
            runtime.stream_generate = lambda *a, **kw: iter([types.SimpleNamespace(text='', finish_reason=None)] * 129)
            with self.assertRaises(common.WorkerError): runtime.answer(request(locale))

    def test_mlx_ipc_labels_checked_target_only(self):
        runtime = types.SimpleNamespace(answer=lambda req: 'Hello.')
        for locale, expected in [('en', {'type': 'answer', 'text': 'Hello.', 'finishReason': 'stop'}),
                                 ('es', {'type': 'answer', 'text': 'Hello.', 'finishReason': 'stop'}),
                                 ('ru', {'type': 'answer', 'text': 'Hello.'})]:
            messages = iter([{'op': 'start', 'options': {}}, {'op': 'answer', 'request': request(locale)}, {'op': 'stop'}])
            out = []
            with patch.object(mlx_worker, 'Runtime', return_value=runtime), patch.object(mlx_worker, 'read_message', side_effect=lambda: next(messages)), patch.object(mlx_worker, 'emit', side_effect=out.append):
                mlx_worker.main()
            self.assertEqual(out, [{'type': 'ready'}, expected])

    def test_ollama_only_accepts_explicit_stop(self):
        runtime = object.__new__(ollama_worker.OllamaWorker)
        runtime.options = {'model': ollama_worker.MODEL, 'threads': 1}
        for reason in ('length', None, 'other', 'stop'):
            frame = {'response': 'Hello.', 'done': True, 'prompt_eval_count': 2}
            if reason is not None: frame['done_reason'] = reason
            runtime.http = lambda *a, **kw: (json.dumps(frame) + '\n').encode()
            if reason == 'stop': self.assertEqual(runtime.generate('x', 128, expected_tokens=2, target=True), 'Hello.')
            else:
                with self.assertRaises(common.WorkerError): runtime.generate('x', 128, expected_tokens=2, target=True)


if __name__ == '__main__': unittest.main()
