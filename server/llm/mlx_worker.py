"""Private JSON-lines MLX LM worker for the existing NPC responder.

The supervisor owns deadlines and kills the complete process group on cancellation.
This worker supports the inspected mlx-lm 0.32.2 API only; it never installs models.
"""
import contextlib
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import platform
import re
import sys

from local_common import (WorkerError, compile_prompt, compile_translation, configure_offline, emit,
                          normalize_text, normalize_target_text, normalize_translation, read_message, verify_manifest)


class Runtime:
    def __init__(self, options):
        if platform.system() != 'Darwin' or platform.machine().lower() != 'arm64':
            raise WorkerError('model_unavailable', 'MLX requires Darwin arm64')
        if not isinstance(options, dict):
            raise WorkerError('invalid_message', 'Invalid worker options')
        directory, manifest, version = (options.get(k) for k in ('modelDir', 'modelManifest', 'runnerVersion'))
        if (not isinstance(directory, str) or not os.path.isabs(directory)
                or not isinstance(manifest, str) or not os.path.isabs(manifest)
                or not isinstance(version, str) or not re.fullmatch(r'\d+\.\d+\.\d+', version)):
            raise WorkerError('invalid_message', 'Invalid MLX configuration')
        if version != '0.32.2':
            raise WorkerError('model_unavailable', 'Unsupported MLX LM version')
        try:
            if importlib.metadata.version('mlx-lm') != version:
                raise WorkerError('model_unavailable', 'MLX LM version mismatch')
        except importlib.metadata.PackageNotFoundError:
            raise WorkerError('model_unavailable', 'MLX LM is not installed') from None
        configure_offline()
        verify_manifest(directory, manifest)
        self._check_artifact(Path(directory))
        # No remote code, remote repository or adapters. Offline environment is set
        # before importing any model library. load uses the existing local directory.
        from mlx_lm import load, generate
        from mlx_lm.generate import generate_step, stream_generate
        from mlx_lm.sample_utils import make_sampler, make_logits_processors
        self._check_api(load, generate, stream_generate, generate_step, make_sampler, make_logits_processors)
        self.generate = generate
        self.stream_generate = stream_generate
        self.sampler = make_sampler(temp=1.0, top_p=1.0, top_k=20)
        self.processors = make_logits_processors(presence_penalty=2.0, repetition_penalty=1.0,
                                                 presence_context_size=2048, repetition_context_size=2048)
        with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink):
            self.model, self.tokenizer = load(directory, tokenizer_config={'trust_remote_code': False},
                                              trust_remote_code=False, lazy=False)
            # Exercise the actual template and tokenizer before signalling ready.
            # This request is synthetic and its generation cache is disposable.
            warm_request = {'locale': 'ru', 'question': 'Здравствуйте!', 'history': [],
                            'npc': {'name': 'Наставник', 'topic': 'Учёба',
                                    'persona': 'Доброжелательный', 'greeting': 'Здравствуйте!'}}
            warm_prompt = compile_prompt(warm_request, self.tokenizer)
            warm_ids = self.tokenizer.encode(warm_prompt, add_special_tokens=False)
            if not isinstance(warm_ids, list) or not warm_ids or len(warm_ids) > 1792:
                raise WorkerError('model_unavailable', 'Invalid tokenizer output')
            self.generate(self.model, self.tokenizer, warm_ids, max_tokens=1,
                          sampler=self.sampler, logits_processors=self.processors, verbose=False)

    @staticmethod
    def _check_api(load, generate, stream, step, sampler, processors):
        for function, required in ((load, ('trust_remote_code', 'tokenizer_config', 'lazy')),
                                   (generate, ('model', 'tokenizer', 'prompt', 'verbose')),
                                   (stream, ('max_tokens',)),
                                   (step, ('max_tokens', 'sampler', 'logits_processors')),
                                   (sampler, ('temp', 'top_p', 'top_k')),
                                   (processors, ('presence_penalty', 'repetition_penalty',
                                                 'presence_context_size', 'repetition_context_size'))):
            if not set(required).issubset(inspect.signature(function).parameters):
                raise WorkerError('model_unavailable', 'Incompatible MLX LM API')

    @staticmethod
    def _check_artifact(root):
        try:
            config_path = root / 'config.json'
            if config_path.stat().st_size > 1024 * 1024:
                raise ValueError()
            config = json.loads(config_path.read_text(encoding='utf-8'))
            if (config.get('model_type') != 'qwen3_5' or 'vision_config' in config
                    or 'audio_config' in config or 'Base' in str(config.get('_name_or_path', ''))):
                raise ValueError()
            quant = config.get('quantization')
            if not isinstance(quant, dict) or quant.get('bits') != 4 or quant.get('group_size') != 64:
                raise ValueError()
            for value in quant.values():
                if isinstance(value, dict) and (value.get('bits', 4) != 4 or value.get('group_size', 64) != 64):
                    raise ValueError()
            weights = list(root.glob('*.safetensors'))
            if not weights:
                raise ValueError()
            # Check tensor names without loading weights. VLM snapshots are not
            # accepted even though mlx-lm itself can silently filter vision weights.
            for weight in weights:
                with weight.open('rb') as f:
                    size = int.from_bytes(f.read(8), 'little')
                    if size <= 0 or size > 16 * 1024 * 1024:
                        raise ValueError()
                    header = json.loads(f.read(size))
                    if not isinstance(header, dict) or any(
                            'vision' in key.lower() or 'visual' in key.lower() or 'audio' in key.lower()
                            for key in header if key != '__metadata__'):
                        raise ValueError()
        except (OSError, ValueError, TypeError, AttributeError, UnicodeError):
            raise WorkerError('model_unavailable', 'Invalid text-only Qwen3.5 4-bit artifact') from None

    def answer(self, request):
        return self._answer_prompt(compile_prompt(request, self.tokenizer),
                                   normalize_target_text if request.get('locale') in ('en', 'es') else None)

    def translate(self, request):
        return self._answer_prompt(compile_translation(request, self.tokenizer), normalize_translation)

    def _answer_prompt(self, prompt, strict_normalize):
        ids = self.tokenizer.encode(prompt, add_special_tokens=False)
        if not isinstance(ids, list) or len(ids) > 1792 or len(ids) + 128 > 2048:
            raise WorkerError('input_too_long', 'Input token limit exceeded')
        with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink):
            if strict_normalize is not None:
                parts = []
                size = 0
                reason = None
                for count, item in enumerate(self.stream_generate(self.model, self.tokenizer, ids, max_tokens=128,
                                                                  sampler=self.sampler, logits_processors=self.processors), 1):
                    chunk = getattr(item, 'text', None)
                    if count > 128 or not isinstance(chunk, str) or reason is not None:
                        raise WorkerError('invalid_response', 'Invalid model response')
                    try:
                        size += len(chunk.encode('utf-8'))
                    except UnicodeError:
                        raise WorkerError('invalid_response', 'Invalid model response') from None
                    if size > 16384:
                        raise WorkerError('output_limit', 'Model output limit exceeded')
                    parts.append(chunk)
                    reason = getattr(item, 'finish_reason', None)
                if reason != 'stop':
                    raise WorkerError('invalid_response', 'Model did not finish normally')
                return strict_normalize(''.join(parts))
            text = self.generate(self.model, self.tokenizer, ids, max_tokens=128,
                                 sampler=self.sampler, logits_processors=self.processors, verbose=False)
        return normalize_text(text)


def main():
    runtime = None
    while True:
        try:
            message = read_message()
            if message is None or message.get('op') == 'stop':
                return
            if message.get('op') == 'start' and runtime is None:
                runtime = Runtime(message.get('options'))
                emit({'type': 'ready'})
            elif message.get('op') == 'answer' and runtime is not None:
                request = message.get('request')
                text = runtime.answer(request)
                emit({'type': 'answer', 'text': text, **({'finishReason': 'stop'} if request.get('locale') in ('en', 'es') else {})})
            elif message.get('op') == 'translate' and runtime is not None:
                text = runtime.translate(message.get('request'))
                emit({'type': 'translation', 'text': text, 'finishReason': 'stop'})
            else:
                raise WorkerError('invalid_message', 'Invalid worker operation')
        except WorkerError as exc:
            emit({'type': 'error', 'code': exc.code, 'message': str(exc)[:200]})
            if runtime is None or exc.code == 'invalid_message':
                return
        except Exception:
            # Do not leak prompt, model output, local paths, or third-party exceptions.
            emit({'type': 'error', 'code': 'model_unavailable', 'message': 'MLX worker failed'})
            return


if __name__ == '__main__':
    main()
