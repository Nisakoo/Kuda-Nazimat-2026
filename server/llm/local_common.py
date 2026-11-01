"""Shared, offline-only helpers for local inference workers."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys

MAX_WIRE = 65536
MAX_TEXT = 16384


class WorkerError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def configure_offline():
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_DATASETS_OFFLINE='1',
                      DO_NOT_TRACK='1', HF_HUB_DISABLE_TELEMETRY='1',
                      USE_TORCH='0', USE_TF='0', USE_FLAX='0')


def read_message():
    line = sys.stdin.buffer.readline(MAX_WIRE + 1)
    if not line:
        return None
    if len(line) > MAX_WIRE or not line.endswith(b'\n'):
        raise WorkerError('invalid_message', 'Invalid IPC message')
    try:
        value = json.loads(line)
    except (ValueError, UnicodeDecodeError):
        raise WorkerError('invalid_message', 'Invalid IPC message') from None
    if not isinstance(value, dict):
        raise WorkerError('invalid_message', 'Invalid IPC message')
    return value


def emit(value):
    data = (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    if len(data) > MAX_WIRE:
        raise WorkerError('output_limit', 'IPC output limit exceeded')
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def verify_manifest(directory, manifestPath):
    try:
        root = Path(directory).resolve(strict=True)
        if not root.is_dir():
            raise ValueError()
        manifest_file = Path(manifestPath).resolve(strict=True)
        with manifest_file.open('rb') as f:
            manifest_data = f.read(MAX_WIRE + 1)
        if len(manifest_data) > MAX_WIRE:
            raise ValueError()
        manifest = json.loads(manifest_data, object_pairs_hook=_unique_pairs)
        if not isinstance(manifest, dict) or not manifest:
            raise ValueError()
        expected = set()
        for name, digest in manifest.items():
            if not isinstance(name, str) or not isinstance(digest, str):
                raise ValueError()
            p = PurePosixPath(name)
            if p.is_absolute() or str(p) != name or any(x in ('.', '..') for x in p.parts) or not re.fullmatch(r'[0-9a-f]{64}', digest):
                raise ValueError()
            path = root.joinpath(*p.parts)
            if any(root.joinpath(*p.parts[:i]).is_symlink() for i in range(1, len(p.parts) + 1)) or not path.is_file():
                raise ValueError()
            h = hashlib.sha256()
            with path.open('rb') as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b''):
                    h.update(chunk)
            if h.hexdigest() != digest:
                raise ValueError()
            expected.add(name)
        actual = set()
        for base, dirs, files in os.walk(root, followlinks=False):
            for d in dirs:
                if (Path(base) / d).is_symlink():
                    raise ValueError()
            dirs[:] = [d for d in dirs if d != '__pycache__']
            for f in files:
                path = Path(base) / f
                if path.is_symlink() or not path.is_file():
                    raise ValueError()
                if path.resolve() == manifest_file:
                    continue
                actual.add(path.relative_to(root).as_posix())
        if actual != expected:
            raise ValueError()
    except (OSError, ValueError, TypeError, UnicodeError):
        raise WorkerError('model_unavailable', 'Artifact manifest verification failed') from None


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def count_prompt_tokens(prompt, tokenizer):
    """Count the exact rendered prompt without adding special tokens."""
    encode = getattr(tokenizer, 'encode', None)
    if callable(encode):
        ids = encode(prompt, add_special_tokens=False)
    else:
        ids = tokenizer(prompt, add_special_tokens=False)['input_ids']
    return len(ids)


def compile_prompt(request, tokenizer):
    try:
        question = request['question']
        npc = request['npc']
        history = request['history']
        if (request['locale'] != 'ru' or not isinstance(question, str) or not question.strip()
                or len(question) > 240 or len(question.encode('utf-8')) > 4096
                or not isinstance(history, list) or len(history) > 6):
            raise ValueError()
        fields = [npc[k] for k in ('name', 'topic', 'persona', 'greeting')]
        if any(not isinstance(s, str) or len(s.encode('utf-8')) > 4096 for s in fields):
            raise ValueError()
        turns = []
        for item in history:
            q, a = item['question'], item['answer']
            if any(not isinstance(s, str) or len(s.encode('utf-8')) > 16384 for s in (q, a)):
                raise ValueError()
            turns.append([{'role': 'user', 'content': q}, {'role': 'assistant', 'content': a}])
    except (KeyError, TypeError, ValueError, UnicodeError):
        raise WorkerError('invalid_message', 'Invalid answer request') from None
    system = ('Ты учебный персонаж. Отвечай по-русски: 1–2 коротких предложения, всего до 20 слов. '
              'На приветствие — короткое приветствие и вопрос. Предложи продолжить разговор. '
              'Не выдумывай факты, если не знаешь, скажи об этом. '
              f'Имя: {fields[0]}. Тема: {fields[1]}. Манера: {fields[2]}. Приветствие: {fields[3]}')
    while True:
        messages = [{'role': 'system', 'content': system}]
        for pair in turns:
            messages.extend(pair)
        messages.append({'role': 'user', 'content': question})
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        if not isinstance(prompt, str):
            raise WorkerError('model_unavailable', 'Invalid tokenizer template')
        if count_prompt_tokens(prompt, tokenizer) <= 1792:
            return prompt
        if not turns:
            raise WorkerError('input_too_long', 'Input token limit exceeded')
        turns.pop(0)


def normalize_text(text):
    if not isinstance(text, str):
        raise WorkerError('invalid_response', 'Invalid model response')
    if len(text.encode('utf-8')) > MAX_TEXT:
        raise WorkerError('output_limit', 'Model output limit exceeded')
    if re.search(r'<\s*/?\s*think\b', text, re.IGNORECASE):
        raise WorkerError('invalid_response', 'Thinking output rejected')
    text = text.replace('\r\n', '\n')
    text = ''.join(c for c in text if c == '\n' or ord(c) >= 32 and not 127 <= ord(c) <= 159)
    text = text.strip()[:4000]
    if not text:
        raise WorkerError('invalid_response', 'Empty model response')
    return text
