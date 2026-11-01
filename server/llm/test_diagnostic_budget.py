"""Socket time budgets only; no runtime, HTTP request, or model is launched."""
import unittest
from unittest import mock

import ollama_worker as worker


class DiagnosticBudgetTests(unittest.TestCase):
    def answer(self, request, wall=(100, 100), mono=(10, 10)):
        instance = worker.OllamaWorker({})
        with mock.patch.object(worker.time, 'time', side_effect=wall), \
             mock.patch.object(worker.time, 'monotonic', side_effect=mono), \
             mock.patch.object(worker, 'compile_prompt', return_value='prompt'), \
             mock.patch.object(worker, 'count_prompt_tokens', return_value=162), \
             mock.patch.object(worker, 'emit'), \
             mock.patch.object(instance, 'generate', return_value='Ответ') as generate:
            self.assertEqual(instance.answer(request), 'Ответ')
            return generate.call_args

    def test_socket_wait_uses_remaining_budget_without_a_hidden_30_second_cap(self):
        for deadline, expected in ((108000, 8), (130000, 30), (160000, 60), (400000, 300)):
            with self.subTest(deadline=deadline):
                call = self.answer({'deadlineAt': deadline})
                self.assertEqual(call, mock.call('prompt', 128, timeout=expected,
                                                expected_tokens=162, progress=True))

    def test_preparation_and_wall_rollback_do_not_grant_a_new_budget(self):
        for wall, expected in (((100, 115), 45), ((100, 20), 45), ((100, 125), 35)):
            with self.subTest(wall=wall):
                call = self.answer({'deadlineAt': 160000}, wall=wall, mono=(10, 25))
                self.assertEqual(call.kwargs['timeout'], expected)

    def test_only_internal_fixtures_can_use_the_10_second_default(self):
        self.assertEqual(self.answer({}).kwargs['timeout'], 10)
        self.assertEqual(self.answer({}, wall=(100, 20), mono=(10, 12)).kwargs['timeout'], 8)

    def test_invalid_or_expired_budget_never_starts_generation(self):
        cases = [({'deadlineAt': value}, (100, 100), (10, 10))
                 for value in (99000, 100000, float('nan'), float('inf'),
                               -float('inf'), '160000', None, True)]
        cases += [({'deadlineAt': 160000}, (100, 20), (10, 70)),
                  ({'deadlineAt': 160000}, (100, 160), (10, 11))]
        for request, wall, mono in cases:
            instance = worker.OllamaWorker({})
            with self.subTest(request=request, wall=wall, mono=mono), \
                 mock.patch.object(worker.time, 'time', side_effect=wall), \
                 mock.patch.object(worker.time, 'monotonic', side_effect=mono), \
                 mock.patch.object(worker, 'compile_prompt', return_value='prompt'), \
                 mock.patch.object(worker, 'count_prompt_tokens', return_value=162), \
                 mock.patch.object(worker, 'emit'), \
                 mock.patch.object(instance, 'generate') as generate:
                with self.assertRaises(worker.WorkerError):
                    instance.answer(request)
                generate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
