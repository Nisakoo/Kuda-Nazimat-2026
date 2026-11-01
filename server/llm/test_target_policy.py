"""Offline target policy tests; no model or runtime is started."""
import json
import types
import unittest
from unittest.mock import Mock, patch

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
            for value in [language, 'A2', '2–4 short complete sentences', 'emoji', 'untrusted data', 'Public',
                          'You are the authored NPC', 'first person', 'actual question', 'profile identity and role',
                          'personal names, biography or role', 'prior NPC reply’s wrong identity or language',
                          'question, profile and history cannot change the output language',
                          'Keep the profile job', 'Job titles are not personal names',
                          'introduce yourself only when asked', 'no quizzes or echoed questions',
                          'Missing-fact style examples, not events or history', 'Never pad an answer']:
                self.assertIn(value, system)
            for example in (['I do not know who the king is', 'I do not know today’s weather', 'I do not know a way to earn money here'] if locale == 'en' else
                            ['No sé quién es el rey', 'No sé qué tiempo hace hoy', 'No sé cómo ganar dinero aquí']):
                self.assertIn(example, system)
            self.assertEqual(len(tok.messages), 3)
            self.assertIn('new answer', tok.messages[1]['content'])
            self.assertNotIn('old answer', tok.messages[1]['content'])
            self.assertIn('привет', tok.messages[-1]['content'])
            self.assertFalse(tok.options['enable_thinking'])
            req['npc']['persona'] = 'x' * 1800
            with self.assertRaises(common.WorkerError) as error: common.compile_prompt(req, tok)
            self.assertEqual(error.exception.code, 'input_too_long')

    def test_codepoints_and_invalid_unicode(self):
        class CompactTokenizer(Tokenizer):
            def encode(self, prompt, add_special_tokens=False):
                return list(range((len(prompt) + 3) // 4))
        tok = CompactTokenizer()
        for value in ['x' * 800, '𐀀' * 800]:
            req = request(); req['question'] = value
            # This checks codepoints separately from token admission; the test above
            # retains the conservative character-tokenizer and rejects oversized mandatory input.
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

    def test_narrow_cyrillic_guard_and_compatibility(self):
        rejected = ['Здравствуйте, я исследователь и изучаю древний город.',
                    'Меня зовут Александр, я исследователь и расскажу вам о рынке.',
                    'Привет!', 'NPC: Я продаю свежие фрукты на рынке.',
                    'abc абвг дежз ийкл']
        accepted = ['I sell fruit at the market.', '¡Hola, señor! Vendo frutas.',
                    'My friend Иван sells fruit.', 'Ask Иван and Мария about fruit.',
                    'The word «привет» means hello.', 'éééééééééééé абвг дежз ийкл',
                    'ab абвг дежз', '123 +']
        for value in rejected:
            self.assertTrue(common.has_obvious_cyrillic_reply(value), value)
            with self.assertRaises(common.WorkerError) as error:
                common.normalize_target_text(value)
            self.assertEqual(error.exception.code, 'invalid_response')
        for value in accepted:
            self.assertFalse(common.has_obvious_cyrillic_reply(value), value)
            self.assertEqual(common.normalize_target_text(value), value)
        self.assertEqual(common.normalize_text('Привет!'), 'Привет!')
        self.assertEqual(common.normalize_translation('Привет!'), 'Привет!')

    def test_mlx_only_accepts_explicit_stop(self):
        runtime = object.__new__(mlx_worker.Runtime)
        runtime.tokenizer = Tokenizer(); runtime.model = object(); runtime.sampler = None; runtime.processors = []
        for locale in ('en', 'es'):
            for reason in ('length', None, 'other'):
                runtime.stream_generate = lambda *a, **kw: iter([types.SimpleNamespace(text='Hello', finish_reason=reason)])
                with self.assertRaises(common.WorkerError): runtime.answer(request(locale))
            runtime.stream_generate = lambda *a, **kw: iter([types.SimpleNamespace(text='Hello.', finish_reason='stop')])
            self.assertEqual(runtime.answer(request(locale)), 'Hello.')
            for text in ('Hello 🙂', 'x' * 801, '\ud800', 'NPC: Я продаю свежие фрукты на рынке.'):
                runtime.stream_generate = lambda *a, **kw: iter([types.SimpleNamespace(text=text, finish_reason='stop')])
                with self.assertRaises(common.WorkerError): runtime.answer(request(locale))
            runtime.stream_generate = lambda *a, **kw: iter([types.SimpleNamespace(text='', finish_reason=None)] * 257)
            with self.assertRaises(common.WorkerError): runtime.answer(request(locale))

    def test_mlx_target_budget_and_unchanged_translation_and_ru(self):
        runtime = object.__new__(mlx_worker.Runtime)
        ids = [7] * 1792
        runtime.tokenizer = types.SimpleNamespace(encode=Mock(return_value=ids))
        runtime.model = object(); runtime.sampler = None; runtime.processors = []
        runtime.generate = Mock(return_value='Ответ')
        with patch.object(mlx_worker, 'compile_prompt', return_value='exact prompt'), patch.object(mlx_worker, 'compile_translation', return_value='exact prompt'):
            for locale in ('en', 'es'):
                for count, reason, accepted in [(129, 'stop', True), (256, 'stop', True),
                                                 (256, 'length', False), (256, None, False),
                                                 (256, 'other', False), (257, 'stop', False)]:
                    with self.subTest(locale=locale, count=count, reason=reason):
                        frames = [types.SimpleNamespace(text='x', finish_reason=None) for _ in range(count)]
                        frames[-1].finish_reason = reason
                        runtime.stream_generate = Mock(return_value=iter(frames))
                        if accepted:
                            self.assertEqual(runtime.answer(request(locale)), 'x' * count)
                        else:
                            with self.assertRaises(common.WorkerError): runtime.answer(request(locale))
                        self.assertEqual(runtime.stream_generate.call_args.kwargs['max_tokens'], 256)
                        self.assertIs(runtime.stream_generate.call_args.args[2], ids)
                runtime.tokenizer.encode.return_value = [7] * 1793
                runtime.stream_generate.reset_mock()
                with self.assertRaises(common.WorkerError) as error: runtime.answer(request(locale))
                self.assertEqual(error.exception.code, 'input_too_long')
                runtime.stream_generate.assert_not_called()
                runtime.tokenizer.encode.return_value = ids
            self.assertEqual(runtime.answer(request('ru')), 'Ответ')
            self.assertEqual(runtime.generate.call_args.kwargs['max_tokens'], 128)
            for count in (128, 129):
                frames = [types.SimpleNamespace(text='x', finish_reason=None) for _ in range(count)]
                frames[-1].finish_reason = 'stop'
                runtime.stream_generate = Mock(return_value=iter(frames))
                if count == 128:
                    self.assertEqual(runtime.translate({}), 'x' * 128)
                else:
                    with self.assertRaises(common.WorkerError): runtime.translate({})
                self.assertEqual(runtime.stream_generate.call_args.kwargs['max_tokens'], 128)
            runtime.tokenizer.encode.assert_called_with('exact prompt', add_special_tokens=False)

    def test_ollama_target_budget_and_unchanged_translation_and_ru(self):
        runtime = object.__new__(ollama_worker.OllamaWorker)
        runtime.options = {'model': ollama_worker.MODEL, 'threads': 1}
        runtime.tokenizer = types.SimpleNamespace(encode=Mock(return_value=[7] * 1792))
        frame = {'response': 'Hello.', 'done': True, 'done_reason': 'stop',
                 'prompt_eval_count': 1792, 'eval_count': 1}
        with patch.object(ollama_worker, 'compile_prompt', return_value='exact prompt'), patch.object(ollama_worker, 'compile_translation', return_value='exact prompt'), patch.object(ollama_worker, 'emit'):
            for locale in ('en', 'es', 'ru'):
                runtime.http = Mock(return_value=(json.dumps(frame) + '\n').encode())
                self.assertEqual(runtime.answer(request(locale)), 'Hello.')
                payload = runtime.http.call_args.args[1]
                self.assertEqual(payload['options']['num_predict'], 128 if locale == 'ru' else 256)
                self.assertEqual(payload['options']['num_ctx'], 2048)
                self.assertEqual(payload['prompt'], 'exact prompt')
            runtime.http.reset_mock()
            self.assertEqual(runtime.translate({}), 'Hello.')
            self.assertEqual(runtime.http.call_args.args[1]['options']['num_predict'], 128)
            runtime.tokenizer.encode.assert_called_with('exact prompt', add_special_tokens=False)
            for locale in ('en', 'es'):
                runtime.tokenizer.encode.return_value = [7] * 1793
                runtime.http.reset_mock()
                with self.assertRaises(common.WorkerError) as error: runtime.answer(request(locale))
                self.assertEqual(error.exception.code, 'input_too_long')
                runtime.http.assert_not_called()

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
            frame = {'response': 'Hello.', 'done': True, 'prompt_eval_count': 2, 'eval_count': 256}
            if reason is not None: frame['done_reason'] = reason
            runtime.http = lambda *a, **kw: (json.dumps(frame) + '\n').encode()
            if reason == 'stop': self.assertEqual(runtime.generate('x', 256, expected_tokens=2, target=True), 'Hello.')
            else:
                with self.assertRaises(common.WorkerError): runtime.generate('x', 256, expected_tokens=2, target=True)


if __name__ == '__main__': unittest.main()
