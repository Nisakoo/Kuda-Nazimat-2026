"""Prompt policy checks only; these do not prove model adherence or speed."""
import unittest

from local_common import compile_prompt


class Tokenizer:
    def apply_chat_template(self, messages, **options):
        self.messages = messages
        self.options = options
        return 'rendered'

    def encode(self, prompt, add_special_tokens=False):
        return [1]


class PromptStyleTests(unittest.TestCase):
    def test_brief_turn_keeps_trusted_profile_honesty_history_and_no_thinking(self):
        tokenizer = Tokenizer()
        profile = {'name': 'Торговка тканями', 'topic': 'Ткани и узоры',
                   'persona': 'Неторопливая мастерица.', 'greeting': 'Присмотрись к узору.'}
        compile_prompt({'locale': 'ru', 'question': 'привет', 'npc': profile,
                        'history': [{'question': 'Что это?', 'answer': 'Узор.'}]}, tokenizer)
        system = tokenizer.messages[0]
        self.assertEqual(system['role'], 'system')
        for value in profile.values():
            self.assertIn(value, system['content'])
        for rule in ('1–2 коротких предложения', 'до 20 слов', 'Не выдумывай факты',
                     'если не знаешь, скажи', 'Предложи продолжить', 'На приветствие'):
            self.assertIn(rule, system['content'])
        self.assertEqual(tokenizer.messages[1:], [
            {'role': 'user', 'content': 'Что это?'}, {'role': 'assistant', 'content': 'Узор.'},
            {'role': 'user', 'content': 'привет'}])
        self.assertFalse(tokenizer.options['enable_thinking'])
        self.assertTrue(tokenizer.options['add_generation_prompt'])


if __name__ == '__main__':
    unittest.main()
