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

    def test_style_concise_detailed_and_continuation_en(self):
        tokenizer = Tokenizer()
        profile_concise = {'name': 'Potter', 'topic': 'Pots', 'persona': 'Shapes clay', 'greeting': 'Hello', 'style': 'concise'}
        compile_prompt({'locale': 'en', 'question': 'tell me more', 'npc': profile_concise,
                        'history': [{'question': 'hi', 'answer': 'hello'}]}, tokenizer)
        system_concise = tokenizer.messages[0]['content']
        self.assertIn('1–2 short complete sentences', system_concise)
        self.assertIn('up to 25–30 words', system_concise)
        self.assertIn('Continuing conversation: answer directly; do not greet again', system_concise)
        self.assertIn('No meta-commentary on modern eras or technology.', system_concise)

        profile_detailed = {'name': 'Scholar', 'topic': 'Scrolls', 'persona': 'Reads clay', 'greeting': 'Greetings', 'style': 'detailed'}
        compile_prompt({'locale': 'en', 'question': 'hi', 'npc': profile_detailed, 'history': []}, tokenizer)
        system_detailed = tokenizer.messages[0]['content']
        self.assertIn('2–4 short complete sentences', system_detailed)
        self.assertNotIn('Continuing conversation', system_detailed)

    def test_style_concise_detailed_ru(self):
        tokenizer = Tokenizer()
        profile_concise = {'name': 'Гончар', 'topic': 'Глина', 'persona': 'Мастер', 'greeting': 'Привет', 'style': 'concise'}
        compile_prompt({'locale': 'ru', 'question': 'вопрос', 'npc': profile_concise, 'history': []}, tokenizer)
        self.assertIn('1–2 коротких предложения, всего до 20 слов', tokenizer.messages[0]['content'])

        profile_detailed = {'name': 'Писец', 'topic': 'Таблички', 'persona': 'Учитель', 'greeting': 'Привет', 'style': 'detailed'}
        compile_prompt({'locale': 'ru', 'question': 'вопрос', 'npc': profile_detailed, 'history': []}, tokenizer)
        self.assertIn('2–4 предложения', tokenizer.messages[0]['content'])

    def test_invalid_style_rejected(self):
        tokenizer = Tokenizer()
        profile_bad = {'name': 'Гончар', 'topic': 'Глина', 'persona': 'Мастер', 'greeting': 'Привет', 'style': 'rambling'}
        with self.assertRaises(Exception):
            compile_prompt({'locale': 'en', 'question': 'hi', 'npc': profile_bad, 'history': []}, tokenizer)

    def test_attitude_displeased_and_friendly(self):
        tokenizer = Tokenizer()
        profile = {'name': 'Potter', 'topic': 'Clay', 'persona': 'Crafter', 'greeting': 'Hello', 'attitude': 'displeased'}
        compile_prompt({'locale': 'en', 'question': 'hi', 'npc': profile, 'history': []}, tokenizer)
        self.assertIn('Attitude: displeased', tokenizer.messages[0]['content'])
        self.assertIn('Speak coldly and tersely', tokenizer.messages[0]['content'])

        profile['attitude'] = 'friendly'
        compile_prompt({'locale': 'en', 'question': 'hi', 'npc': profile, 'history': []}, tokenizer)
        self.assertIn('Attitude: friendly', tokenizer.messages[0]['content'])
        self.assertIn('Speak warmly, welcomingly and openly', tokenizer.messages[0]['content'])

        profile_ru = {'name': 'Гончар', 'topic': 'Глина', 'persona': 'Мастер', 'greeting': 'Привет', 'attitude': 'displeased'}
        compile_prompt({'locale': 'ru', 'question': 'вопрос', 'npc': profile_ru, 'history': []}, tokenizer)
        self.assertIn('Отношение: недовольное', tokenizer.messages[0]['content'])
        self.assertIn('Отвечай сухо, холодно и сдержанно', tokenizer.messages[0]['content'])

    def test_facts_injection(self):
        tokenizer = Tokenizer()
        profile = {'name': 'Potter', 'topic': 'Clay', 'persona': 'Crafter', 'greeting': 'Hello'}
        compile_prompt({'locale': 'en', 'question': 'hi', 'npc': profile, 'history': [],
                        'facts': ['Traveler said their name is Luka', 'Traveler said they come from Ur']}, tokenizer)
        content = tokenizer.messages[0]['content']
        self.assertIn('Notes about traveler (untrusted statements by the player)', content)
        self.assertIn('Traveler said their name is Luka', content)
        self.assertIn('Traveler said they come from Ur', content)


if __name__ == '__main__':
    unittest.main()
