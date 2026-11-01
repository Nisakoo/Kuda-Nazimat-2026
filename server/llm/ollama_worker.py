"""Owned Ollama worker. Loopback alone is not an OS isolation boundary."""
from contextlib import contextmanager, nullcontext
import hashlib
import importlib.metadata
import json
import os
import re
import signal
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from local_common import WorkerError, _unique_pairs, compile_prompt, configure_offline, count_prompt_tokens, emit, normalize_text, read_message, verify_manifest

MODEL = 'qwen3.5:2b-q4_K_M'
WIRE_LIMIT = 65536
LINE_LIMIT = 32768
MANIFEST_TYPE = 'application/vnd.docker.distribution.manifest.v2+json'
MODEL_TYPE = 'application/vnd.ollama.image.model'
MANIFEST_REFERENCE_TYPES = frozenset((
    MANIFEST_TYPE,
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.ollama.manifest.list.v2+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.oci.image.index.v1+json',
))


def digest_hex(value):
    if not isinstance(value, str):
        raise WorkerError('model_unavailable', 'Invalid model digest')
    value = value.removeprefix('sha256:').lower()
    if not re.fullmatch(r'[0-9a-f]{64}', value):
        raise WorkerError('model_unavailable', 'Invalid model digest')
    return value


def _legacy_anchor_matches(active, active_digest, active_size, legacy):
    """Compare metadata only; the caller must first verify both sets of blobs."""
    anchors = [e for e in legacy['layers'] if e.get('mediaType') in MANIFEST_REFERENCE_TYPES]
    if (len(anchors) != 1 or anchors[0].get('mediaType') != MANIFEST_TYPE
            or digest_hex(anchors[0]['digest']) != active_digest or anchors[0]['size'] != active_size):
        return False
    # Binding requires the same runnable payload, not merely a reachable SHA.
    if any(active.get(field) != legacy.get(field) for field in ('config', 'runner', 'format')):
        return False
    return active['layers'] == [e for e in legacy['layers'] if e.get('mediaType') != MANIFEST_TYPE]


def verify_ollama_model(directory, expected_digest):
    """Return the verified active SHA, with only direct legacy-anchor compatibility.

    No manifest-list traversal or runner selection is supported. Named v2 links
    are the sole symlink exception; all blobs and parent directories stay local.
    """
    try:
        pin = digest_hex(expected_digest)
        root = Path(directory).resolve(strict=True)
        if not root.is_dir():
            raise ValueError()

        def local_path(parts):
            path = root
            for part in parts:
                path = path / part
                if path.is_symlink():
                    raise ValueError()
            return path

        def local_file(parts):
            path = local_path(parts)
            if not path.is_file():
                raise ValueError()
            return path

        def read_manifest(path, linked=False):
            filename_digest = None
            if linked:
                # Normalize lexically, not through resolve(), which hides chains.
                target = path.parent / os.readlink(path)
                walked = Path(target.anchor)
                for part in target.parts[1:]:
                    walked = walked / part
                    if walked.is_symlink():
                        raise ValueError()
                target = Path(os.path.normpath(target))
                if target.parent != root / 'blobs' or not re.fullmatch(r'sha256-[0-9a-fA-F]{64}', target.name):
                    raise ValueError()
                path = local_file(('blobs', target.name))
                filename_digest = target.name[7:].lower()
            with path.open('rb') as f:
                data = f.read(WIRE_LIMIT + 1)
            digest = hashlib.sha256(data).hexdigest()
            if len(data) > WIRE_LIMIT or (filename_digest is not None and digest != filename_digest):
                raise ValueError()
            manifest = json.loads(data, object_pairs_hook=_unique_pairs)
            if (not isinstance(manifest, dict)
                    or not isinstance(manifest.get('schemaVersion'), int)
                    or isinstance(manifest.get('schemaVersion'), bool) or manifest['schemaVersion'] != 2
                    or manifest.get('mediaType') != MANIFEST_TYPE or 'manifests' in manifest
                    or not isinstance(manifest.get('config'), dict)
                    or not isinstance(manifest.get('layers'), list)
                    or not any(isinstance(e, dict) and e.get('mediaType') == MODEL_TYPE for e in manifest['layers'])):
                raise ValueError()
            return manifest, digest, len(data)

        def verify_blobs(manifest):
            for entry in [manifest['config'], *manifest['layers']]:
                if not isinstance(entry, dict):
                    raise ValueError()
                digest = digest_hex(entry.get('digest'))
                size = entry.get('size')
                if not isinstance(size, int) or isinstance(size, bool) or size < 0:
                    raise ValueError()
                blob = local_file(('blobs', 'sha256-' + digest))
                h = hashlib.sha256()
                total = 0
                with blob.open('rb') as f:
                    for chunk in iter(lambda: f.read(1024 * 1024), b''):
                        total += len(chunk)
                        if total > size:
                            raise ValueError()
                        h.update(chunk)
                if total != size or h.hexdigest() != digest:
                    raise ValueError()

        legacy_parts = ('manifests', 'registry.ollama.ai', 'library', 'qwen3.5', '2b-q4_K_M')
        v2_parts = ('manifests-v2', 'ollama.com', 'library', 'qwen3.5', '2b-q4_K_M')
        # Check parents even when the final name is missing. A dangling link is
        # present, invalid v2 state, never permission to fall back to legacy.
        v2 = local_path(v2_parts[:-1]) / v2_parts[-1]
        has_v2 = os.path.lexists(v2)
        active_path = v2 if has_v2 else local_file(legacy_parts)
        if not active_path.is_symlink() and not active_path.is_file():
            raise ValueError()
        active, active_digest, active_size = read_manifest(active_path, linked=has_v2 and v2.is_symlink())
        # Only the legacy compatibility document can carry its one direct anchor.
        # Runnable manifests never select or retain other manifest references.
        if any(isinstance(e, dict) and e.get('mediaType') in MANIFEST_REFERENCE_TYPES for e in active['layers']):
            raise ValueError()
        verify_blobs(active)
        if pin == active_digest:
            return active_digest
        if not has_v2:
            raise ValueError()

        legacy, legacy_digest, _ = read_manifest(local_file(legacy_parts))
        if legacy_digest != pin:
            raise ValueError()
        verify_blobs(legacy)
        if not _legacy_anchor_matches(active, active_digest, active_size, legacy):
            raise ValueError()
        return active_digest
    except (OSError, ValueError, TypeError, UnicodeError, RecursionError, WorkerError):
        raise WorkerError('model_unavailable', 'Ollama model verification failed') from None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


def owned_listener(pid, port):
    """Fail closed unless every listener on the port belongs to our serve PID."""
    if sys.platform.startswith('linux'):
        try:
            inodes = set()
            for table in ('/proc/net/tcp', '/proc/net/tcp6'):
                with open(table, encoding='ascii') as f:
                    next(f)
                    for line in f:
                        cols = line.split()
                        if cols[3] == '0A' and int(cols[1].split(':')[1], 16) == port:
                            inodes.add(cols[9])
            owned = set()
            for fd in Path('/proc', str(pid), 'fd').iterdir():
                try:
                    target = os.readlink(fd)
                    if target.startswith('socket:['):
                        owned.add(target[8:-1])
                except OSError:
                    continue
            return bool(inodes) and inodes <= owned
        except (OSError, ValueError, IndexError):
            return False
    if sys.platform == 'darwin':
        try:
            result = subprocess.run(['/usr/sbin/lsof', '-nP', '-t', '-iTCP:%d' % port, '-sTCP:LISTEN'],
                                    capture_output=True, text=True, timeout=2, check=False)
            return result.returncode == 0 and set(result.stdout.split()) == {str(pid)}
        except (OSError, subprocess.SubprocessError):
            return False
    return False


class _StopRequested(BaseException):
    """Internal control flow; request/HTTP Exception handlers must not catch it."""


class _Termination:
    def __init__(self):
        self.pending = False
        self.deferred = 0
        self.cleaning = False

    def handle(self, signum, frame):
        self.pending = True
        self.check()

    def check(self):
        if self.pending and not self.deferred and not self.cleaning:
            # Set this before raising: later SIGTERM must not interrupt unwinding
            # or cleanup, including the wait that anchors supervisor escalation.
            self.cleaning = True
            raise _StopRequested()

    @contextmanager
    def spawning(self):
        # Popen can create a process before returning its ownership handle. Do
        # not unwind that constructor until the caller has assigned self.child.
        self.deferred += 1
        try:
            yield
        finally:
            self.deferred -= 1
            self.check()


class OllamaWorker:
    def __init__(self, options):
        self.options = options
        self.stage = None
        self.child = None
        self.termination = None
        self.runtime = None
        self.tokenizer = None
        self.model_digest = None
        self.port = options.get('port', 11501)
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def start(self):
        o = self.options
        self.stage = 'ollama_options'
        try:
            if (o['model'] != MODEL or not isinstance(self.port, int) or isinstance(self.port, bool)
                    or not 1 <= self.port <= 65535 or not isinstance(o['threads'], int) or isinstance(o['threads'], bool)
                    or o['threads'] < 1 or not isinstance(o.get('numGpu', 0), int) or isinstance(o.get('numGpu', 0), bool)
                    or o.get('numGpu', 0) < 0 or not isinstance(o['startupTimeoutMs'], int) or o['startupTimeoutMs'] <= 0
                    or not isinstance(o['modelDigest'], str) or not o['modelDigest']
                    or not isinstance(o['runnerVersion'], str) or not o['runnerVersion']):
                raise ValueError()
            for key in ('python', 'executable', 'modelsDir', 'tokenizerDir', 'tokenizerManifest'):
                if not isinstance(o[key], str) or not os.path.isabs(o[key]):
                    raise ValueError()
        except (KeyError, TypeError, ValueError):
            raise WorkerError('invalid_config', 'Invalid worker configuration') from None
        self.stage = 'ollama_tokenizer_integrity'
        configure_offline()
        verify_manifest(o['tokenizerDir'], o['tokenizerManifest'])
        self.stage = 'ollama_model_integrity'
        self.model_digest = verify_ollama_model(o['modelsDir'], o['modelDigest'])
        self.stage = 'ollama_dependencies'
        try:
            if importlib.metadata.version('transformers') != '4.57.6' or importlib.metadata.version('jinja2') != '3.1.6':
                raise WorkerError('model_unavailable', 'Tokenizer dependency version mismatch')
        except importlib.metadata.PackageNotFoundError:
            raise WorkerError('model_unavailable', 'Tokenizer dependency unavailable') from None
        from transformers import AutoTokenizer
        self.stage = 'ollama_tokenizer_load'
        self.tokenizer = AutoTokenizer.from_pretrained(o['tokenizerDir'], local_files_only=True, trust_remote_code=False)
        self.stage = 'ollama_template'
        compile_prompt({'locale': 'ru', 'question': 'Привет', 'history': [],
                        'npc': {'name': 'NPC', 'topic': 'учёба', 'persona': 'кратко', 'greeting': 'Привет'}}, self.tokenizer)
        self.stage = 'ollama_port'
        if not port_free(self.port):
            raise WorkerError('model_unavailable', 'Ollama port is occupied')
        self.stage = 'ollama_runtime_directory'
        models_root = Path(o['modelsDir']).resolve(strict=True)
        if not models_root.is_dir():
            raise WorkerError('invalid_config', 'Invalid models directory')
        runtime_root = models_root / '.runtime'
        if runtime_root.is_symlink():
            raise WorkerError('invalid_config', 'Invalid runtime directory')
        runtime_root.mkdir(mode=0o700, exist_ok=True)
        if not runtime_root.is_dir() or runtime_root.stat().st_mode & 0o077:
            raise WorkerError('invalid_config', 'Runtime directory must be private')
        self.runtime = tempfile.TemporaryDirectory(prefix='ollama-', dir=runtime_root)
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith(('OLLAMA_', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'))}
        env.update(HOME=self.runtime.name, TMPDIR=self.runtime.name, OLLAMA_HOST='127.0.0.1:%d' % self.port,
                   OLLAMA_MODELS=o['modelsDir'], OLLAMA_NO_CLOUD='1', OLLAMA_NUM_PARALLEL='1',
                   OLLAMA_MAX_LOADED_MODELS='1', OLLAMA_ORIGINS='http://127.0.0.1',
                   OMP_NUM_THREADS=str(o['threads']))
        # The supervisor owns the process group. The daemon must inherit it.
        self.stage = 'ollama_spawn'
        with self.termination.spawning() if self.termination is not None else nullcontext():
            self.child = subprocess.Popen([o['executable'], 'serve'], env=env, stdin=subprocess.DEVNULL,
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.stage = 'ollama_listener'
        deadline = time.monotonic() + o['startupTimeoutMs'] / 1000
        while time.monotonic() < deadline:
            if self.child.poll() is not None:
                raise WorkerError('model_unavailable', 'Ollama failed to start')
            if owned_listener(self.child.pid, self.port):
                break
            time.sleep(0.05)
        else:
            raise WorkerError('model_unavailable', 'Ollama did not become ready')
        self.stage = 'ollama_version'
        version = self.http('/api/version', timeout=max(0.1, deadline - time.monotonic()))
        if version.get('version') != o['runnerVersion']:
            raise WorkerError('model_unavailable', 'Ollama version mismatch')
        self.stage = 'ollama_model_digest'
        tags = self.http('/api/tags', timeout=max(0.1, deadline - time.monotonic()))
        models = tags.get('models')
        if not isinstance(models, list) or not any(isinstance(m, dict) and m.get('name') == MODEL and isinstance(m.get('digest'), str) and digest_hex(m['digest']) == self.model_digest for m in models):
            raise WorkerError('model_unavailable', 'Ollama model digest mismatch')
        self.stage = 'ollama_warmup'
        self.generate('', 0, timeout=max(0.1, deadline - time.monotonic()), allow_empty=True)
        self.stage = 'ollama_calibration'
        for question in ('Почему небо голубое?', 'Explain a small example.', 'Что значит 🚀?'):
            probe = {'locale': 'ru', 'question': question, 'history': [],
                     'npc': {'name': 'NPC', 'topic': 'учёба', 'persona': 'кратко', 'greeting': 'Привет'}}
            prompt = compile_prompt(probe, self.tokenizer)
            expected = count_prompt_tokens(prompt, self.tokenizer)
            self.generate(prompt, 1, timeout=max(0.1, deadline - time.monotonic()),
                          allow_empty=True, expected_tokens=expected)
        self.stage = None

    def http(self, path, payload=None, timeout=10, stream=False):
        if path not in ('/api/version', '/api/tags', '/api/generate'):
            raise WorkerError('invalid_config', 'Invalid runner endpoint')
        if self.child is None or self.child.poll() is not None or not owned_listener(self.child.pid, self.port):
            raise WorkerError('model_unavailable', 'Owned Ollama listener unavailable')
        data = None if payload is None else json.dumps(payload, separators=(',', ':')).encode()
        req = urllib.request.Request('http://127.0.0.1:%d%s' % (self.port, path), data=data,
                                     headers={'Content-Type': 'application/json'})
        try:
            with self.opener.open(req, timeout=timeout) as response:
                raw = response.read(WIRE_LIMIT + 1)
            if len(raw) > WIRE_LIMIT:
                raise WorkerError('output_limit', 'Runner wire limit exceeded')
            if any(len(line) > LINE_LIMIT for line in raw.splitlines()):
                raise WorkerError('output_limit', 'Runner line limit exceeded')
            if stream:
                return raw
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError()
            return result
        except WorkerError:
            raise
        except urllib.error.HTTPError as exc:
            diagnostic = 'ollama_runner_rejected'
            try:
                body = exc.read(LINE_LIMIT)
                parsed = json.loads(body)
                message = parsed.get('error', '') if isinstance(parsed, dict) else ''
                if isinstance(message, str) and re.search(r'model requires more system memory|not enough memory', message, re.IGNORECASE):
                    diagnostic = 'ollama_memory_insufficient'
            except (OSError, ValueError, UnicodeError):
                pass
            error = WorkerError('model_unavailable', 'Ollama request failed')
            error.diagnostic = diagnostic
            raise error from None
        except (OSError, urllib.error.URLError):
            error = WorkerError('model_unavailable', 'Ollama request failed')
            error.diagnostic = 'ollama_runner_connection'
            raise error from None
        except (ValueError, UnicodeError):
            error = WorkerError('model_unavailable', 'Ollama request failed')
            error.diagnostic = 'ollama_response_invalid'
            raise error from None

    def generate(self, prompt, predict, timeout=10, allow_empty=False, expected_tokens=None):
        if expected_tokens is not None and (not isinstance(expected_tokens, int) or isinstance(expected_tokens, bool) or not 0 <= expected_tokens <= 1792):
            raise WorkerError('input_too_long', 'Input token limit exceeded')
        o = self.options
        payload = {'model': MODEL, 'prompt': prompt, 'raw': True, 'think': False, 'stream': True, 'keep_alive': -1,
                   'options': {'num_ctx': 2048, 'num_predict': predict, 'num_thread': o['threads'],
                               'num_gpu': o.get('numGpu', 0), 'temperature': 1.0, 'top_p': 1.0,
                               'top_k': 20, 'presence_penalty': 2.0, 'repeat_penalty': 1.0}}
        raw = self.http('/api/generate', payload, timeout=timeout, stream=True)
        parts = []
        size = 0
        done = False
        try:
            for line in raw.splitlines():
                if not line.strip():
                    continue
                obj = json.loads(line)
                if not isinstance(obj, dict) or done or obj.get('error') or obj.get('thinking'):
                    raise ValueError()
                text = obj.get('response', '')
                if not isinstance(text, str) or not isinstance(obj.get('done', False), bool):
                    raise ValueError()
                size += len(text.encode('utf-8'))
                if size > 16384:
                    raise WorkerError('output_limit', 'Model output limit exceeded')
                parts.append(text)
                done = obj.get('done', False)
                if done and expected_tokens is not None:
                    actual = obj.get('prompt_eval_count')
                    if (not isinstance(actual, int) or isinstance(actual, bool)
                            or actual < 0 or actual > 1792 or actual != expected_tokens):
                        error = WorkerError('invalid_response', 'Invalid runner response')
                        error.diagnostic = 'ollama_token_count_mismatch'
                        raise error
            if not done:
                raise ValueError()
        except (ValueError, UnicodeError):
            error = WorkerError('invalid_response', 'Invalid runner response')
            error.diagnostic = 'ollama_response_invalid'
            raise error from None
        text = ''.join(parts)
        if allow_empty and not text:
            return ''
        return normalize_text(text)

    def answer(self, request):
        prompt = compile_prompt(request, self.tokenizer)
        return self.generate(prompt, 128, expected_tokens=count_prompt_tokens(prompt, self.tokenizer))

    def stop(self):
        if self.child is not None:
            if self.child.poll() is None:
                self.child.terminate()
                try:
                    self.child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.child.kill()
                    self.child.wait(timeout=2)
            self.child = None
        if self.runtime is not None:
            self.runtime.cleanup()
            self.runtime = None


def main():
    worker = None
    termination = _Termination()
    previous_handler = signal.getsignal(signal.SIGTERM)
    try:
        signal.signal(signal.SIGTERM, termination.handle)
        try:
            first = read_message()
            if first is None:
                termination.cleaning = True
                return
            if first.get('op') != 'start' or not isinstance(first.get('options'), dict):
                raise WorkerError('invalid_message', 'Expected start message')
            worker = OllamaWorker(first['options'])
            worker.termination = termination
            worker.start()
            worker.stage = None
            emit({'type': 'ready'})
            while True:
                msg = read_message()
                if msg is None or msg.get('op') == 'stop':
                    break
                if msg.get('op') != 'answer' or not isinstance(msg.get('request'), dict):
                    raise WorkerError('invalid_message', 'Expected answer message')
                emit({'type': 'answer', 'text': worker.answer(msg['request'])})
        except WorkerError as exc:
            result = {'type': 'error', 'code': exc.code, 'message': str(exc)[:200]}
            diagnostic = getattr(exc, 'diagnostic', None) or (worker.stage if worker is not None else None)
            if diagnostic:
                result['diagnostic'] = diagnostic
            emit(result)
        except Exception:
            result = {'type': 'error', 'code': 'model_unavailable', 'message': 'Local worker failed'}
            if worker is not None and worker.stage:
                result['diagnostic'] = worker.stage
            emit(result)
        # Suppress TERM before leaving the protected scope on normal stop/EOF
        # or error, not only after entering finally. Cancellation sets this in
        # the handler before unwinding, including during error reporting.
        termination.cleaning = True
    except _StopRequested:
        pass
    finally:
        termination.cleaning = True
        try:
            if worker is not None:
                try:
                    worker.stop()
                except Exception:
                    print('Local worker cleanup failed', file=sys.stderr)
        finally:
            signal.signal(signal.SIGTERM, previous_handler)


if __name__ == '__main__':
    main()
