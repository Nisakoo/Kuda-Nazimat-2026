"""Socket time budgets only; no runtime, HTTP request, or model is launched."""
import unittest
from unittest import mock

import ollama_worker as worker


class DiagnosticBudgetTests(unittest.TestCase):
    def test_socket_wait_uses_remaining_request_budget_but_never_exceeds_30_seconds(self):
        instance = worker.OllamaWorker({})
        for deadline, expected in ((108000, 8), (130000, 30), (200000, 30), (99000, .001)):
            with self.subTest(deadline=deadline), \
                 mock.patch.object(worker.time, 'time', return_value=100), \
                 mock.patch.object(worker, 'compile_prompt', return_value='prompt'), \
                 mock.patch.object(worker, 'count_prompt_tokens', return_value=162), \
                 mock.patch.object(worker, 'emit'), \
                 mock.patch.object(instance, 'generate', return_value='Ответ') as generate:
                self.assertEqual(instance.answer({'deadlineAt': deadline}), 'Ответ')
                generate.assert_called_once_with('prompt', 128, timeout=expected,
                                                 expected_tokens=162, progress=True)


if __name__ == '__main__':
    unittest.main()
