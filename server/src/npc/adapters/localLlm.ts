import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Clock, Scheduler, TimerHandle } from '../../common/time.ts';
import type { NpcAnswerRequest, NpcDiagnostics, NpcResponder } from '../NpcResponder.ts';
import { isNpcFailureCode, type NpcFailureCode } from '../failureCodes.ts';

type Backend = 'ollama' | 'mlx';
type Deps = { clock: Clock; scheduler: Scheduler };
type Failure = NpcFailureCode;
export interface LocalLlmResponder extends NpcResponder {
  status(): 'ready' | 'unavailable';
  lastFailure(): Failure | undefined;
}
const LIMIT = 64 * 1024;
const TEXT_LIMIT = 16 * 1024;
const SOFT_RSS = 3_500_000_000;
const failures = new Set<Failure>(['model_unavailable', 'runner_mismatch', 'tokenizer_unavailable', 'resource_limit', 'input_too_long', 'output_limit']);

function validate(backend: Backend, input: Record<string, unknown>): Record<string, unknown> {
  if (backend !== 'ollama' && backend !== 'mlx') throw new Error('Invalid NPC backend');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid npc.options');
  const common = ['python', 'startupTimeoutMs', 'threads', 'runnerVersion'];
  const specific = backend === 'ollama'
    ? ['executable', 'modelsDir', 'tokenizerDir', 'tokenizerManifest', 'model', 'modelDigest', 'port', 'numGpu']
    : ['modelDir', 'modelManifest'];
  if (Reflect.ownKeys(input).some((key) => typeof key !== 'string' || ![...common, ...specific].includes(key))) throw new Error('Unknown npc.options key');
  const result = { ...input };
  for (const key of ['python', ...(backend === 'ollama' ? ['executable', 'modelsDir', 'tokenizerDir', 'tokenizerManifest'] : ['modelDir', 'modelManifest'])]) {
    const value = result[key];
    if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value) || !isAbsolute(value)) throw new Error(`Invalid npc.options.${key}: absolute path required`);
  }
  const ranges = backend === 'ollama'
    ? { startupTimeoutMs: [120000, 1, 120000], threads: [2, 1, 64], port: [11501, 1024, 65535], numGpu: [0, 0, 128] }
    : { startupTimeoutMs: [120000, 1, 120000], threads: [2, 1, 64] };
  for (const [key, range] of Object.entries(ranges)) {
    const value = Object.hasOwn(result, key) ? result[key] : range[0];
    if (!Number.isSafeInteger(value) || (value as number) < range[1]! || (value as number) > range[2]!) throw new Error(`Invalid npc.options.${key}`);
    result[key] = value;
  }
  if (typeof result.runnerVersion !== 'string' || result.runnerVersion.length > 64 || !/^\d+\.\d+\.\d+$/.test(result.runnerVersion)) throw new Error('Invalid npc.options.runnerVersion');
  if (backend === 'ollama') {
    if (result.model !== 'qwen3.5:2b-q4_K_M' && result.model !== 'qwen3.5:0.8b-q8_0') throw new Error('Invalid npc.options.model');
    if (typeof result.modelDigest !== 'string' || !/^(?:sha256:)?[a-fA-F0-9]{64}$/.test(result.modelDigest)) throw new Error('Invalid npc.options.modelDigest');
  }
  return Object.freeze(result);
}

/** Measure the projected, shallow IPC value before allocating its serialized buffer. */
function jsonBytes(value: unknown): number {
  if (typeof value === 'string') {
    if (value.length > LIMIT) return LIMIT + 1;
    let bytes = 2;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) bytes += 2;
      else if (code < 32) bytes += 6;
      else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
      else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
      if (bytes > LIMIT) return LIMIT + 1;
    }
    return bytes;
  }
  if (typeof value === 'number') return String(value).length;
  const entries = Array.isArray(value) ? value.map((item) => [undefined, item] as const) : Object.entries(value as object);
  let bytes = 2;
  for (let i = 0; i < entries.length; i++) {
    const [key, item] = entries[i]!;
    bytes += (i ? 1 : 0) + (key === undefined ? 0 : jsonBytes(key) + 1) + jsonBytes(item);
    if (bytes > LIMIT) return LIMIT + 1;
  }
  return bytes;
}
function boundedRequest(request: NpcAnswerRequest): NpcAnswerRequest | undefined {
  if (!request || !request.npc || !Array.isArray(request.history) || request.locale !== 'ru' || !Number.isFinite(request.deadlineAt)) return;
  const { requestKey, playerId, playerName, question, locale, deadlineAt } = request;
  const { id, name, topic, persona, greeting } = request.npc;
  if (![requestKey, playerId, playerName, question, id, name, topic, persona, greeting].every((value) => typeof value === 'string')) return;
  if (Buffer.byteLength(question) > 4096) return;
  const history = request.history.slice(-6);
  if (history.some((entry) => !entry || typeof entry.question !== 'string' || typeof entry.answer !== 'string')) return;
  const safe: NpcAnswerRequest = { requestKey, playerId, playerName, question, locale, deadlineAt, npc: { id, name, topic, persona, greeting }, history: history.map(({ question, answer }) => ({ question, answer })) };
  while (jsonBytes({ op: 'answer', request: safe }) + 1 > LIMIT) {
    if (!safe.history.length) return;
    // Whole oldest pairs only. The worker still performs exact tokenizer admission afterwards.
    (safe.history as { question: string; answer: string }[]).shift();
  }
  return safe;
}

interface ProcessRow { pid: number; parent: number; group: number; rss: number; zombie: boolean }
function processTable(run: typeof execFile = execFile): Promise<ProcessRow[]> {
  return new Promise((resolve, reject) => {
    run('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,rss=,stat='], { timeout: 500, maxBuffer: 1024 * 1024, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => {
      if (error) {
        const reason = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'memory_sample_ps_limit'
          : error.killed ? 'memory_sample_ps_timeout' : 'memory_sample_ps_failed';
        reject(new Error(reason)); return;
      }
      const rows: ProcessRow[] = [];
      for (const line of stdout.trim().split('\n')) {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
        if (!match) { reject(new Error('memory_sample_parse')); return; }
        const row = { pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), rss: Number(match[4]) * 1024, zombie: match[5]!.startsWith('Z') };
        if (![row.pid, row.parent, row.group, row.rss].every(Number.isSafeInteger)) { reject(new Error('memory_sample_parse')); return; }
        rows.push(row);
      }
      resolve(rows);
    });
  });
}
async function memoryBytes(group: number, run: typeof execFile = execFile): Promise<number> {
  const rows = await processTable(run);
  if (!rows.some((row) => row.pid === process.pid)) throw new Error('memory_sample_missing');
  // Conservatively count all of Node and its descendants, plus reparented owned group members.
  const included = new Set([process.pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) if ((included.has(row.parent) || row.group === group) && !included.has(row.pid)) { included.add(row.pid); changed = true; }
  }
  return rows.reduce((total, row) => total + (included.has(row.pid) ? row.rss : 0), 0);
}
async function groupAlive(group: number): Promise<boolean> {
  // Zombies have no model memory or computation. The direct Python child must also emit exit.
  return (await processTable()).some((row) => row.group === group && !row.zombie);
}

/** Internal command-callback seam. Operator configuration cannot replace the OS command. */
export const memoryBytesForTest = memoryBytes;

/** Internal fixture seam. Never read these values from operator configuration. */
interface Runtime {
  answerCeilingMs: 9000 | 30000;
  workerPath: string;
  workerPrefix?: readonly string[];
  platform: string;
  arch: string;
  monotonicNow(): number;
  memoryBytes(group: number): Promise<number>;
  groupAlive(group: number): Promise<boolean>;
}
interface Pending {
  reject(error: Error): void;
  clear(): void;
}
interface Session {
  child: ChildProcessWithoutNullStreams;
  group: number | undefined;
  exited: boolean;
  phase: 'starting' | 'ready' | 'stopping';
  startup: Pending & { resolve(): void };
  answer?: Pending & { resolve(value: { text: string }): void; expired(): boolean; aborted(): boolean };
  buffer: Buffer;
  outputBytes: number;
  messageCount: number;
  stderrBytes: number;
  readyReceived: boolean;
  measured: boolean;
  startupExpired(): boolean;
  watchdog?: TimerHandle;
  cleanup?: Promise<void>;
  failure?: Failure;
}

export function localLlm(backend: Backend, options: Record<string, unknown>, deps: Deps): LocalLlmResponder {
  return build(backend, validate(backend, options), deps, {
    answerCeilingMs: 9000,
    workerPath: fileURLToPath(new URL(`../../../llm/${backend}_worker.py`, import.meta.url)),
    platform: process.platform, arch: process.arch, monotonicNow: () => performance.now(), memoryBytes, groupAlive,
  });
}
export const ollama = (options: Record<string, unknown>, deps: Deps): LocalLlmResponder => localLlm('ollama', options, deps);
export const mlx = (options: Record<string, unknown>, deps: Deps): LocalLlmResponder => localLlm('mlx', options, deps);
/** Operator-only, offline-from-the-game probe. Never registered as a game adapter
 * or selected by config. All ownership, memory, cancellation and IPC guards stay.
 */
export function ollamaDiagnostic(options: Record<string, unknown>, deps: Deps): LocalLlmResponder {
  return build('ollama', validate('ollama', options), deps, {
    answerCeilingMs: 30000,
    workerPath: fileURLToPath(new URL('../../../llm/ollama_worker.py', import.meta.url)),
    platform: process.platform, arch: process.arch, monotonicNow: () => performance.now(), memoryBytes, groupAlive,
  });
}
export function localLlmForTest(backend: Backend, options: Record<string, unknown>, deps: Deps, runtime: Partial<Runtime> & Pick<Runtime, 'workerPath'>): LocalLlmResponder {
  return build(backend, validate(backend, options), deps, {
    answerCeilingMs: 9000, platform: process.platform, arch: process.arch, monotonicNow: () => performance.now(), memoryBytes, groupAlive, ...runtime,
  });
}

function build(backend: Backend, options: Record<string, unknown>, deps: Deps, runtime: Runtime): LocalLlmResponder {
  const { clock, scheduler } = deps;
  let owned: Session | undefined;
  let starting: Promise<void> | undefined;
  let lastFailure: Failure | undefined;
  let diagnostic: NpcDiagnostics | undefined;
  let diagnosticBegan = 0;
  let diagnosticEnd: number | undefined;
  let answerAccepted = false;
  const elapsed = () => {
    const value = (diagnosticEnd ?? runtime.monotonicNow()) - diagnosticBegan;
    return Number.isFinite(value) ? Math.max(0, Math.min(120000, Math.floor(value))) : 0;
  };
  const freezeDiagnostic = () => { if (diagnostic && diagnosticEnd === undefined) diagnosticEnd = runtime.monotonicNow(); };
  const delay = (ms: number) => new Promise<void>((resolve) => scheduler.setTimeout(resolve, ms));
  function signalGroup(s: Session, signal: NodeJS.Signals): void {
    // Only our detached process group. Never address an external runner or an arbitrary PID.
    // Once the leader exits, its numeric identity can be reused. Residual groups are quarantined,
    // not signalled. The worker must reap its own runner before it exits normally.
    if (s.exited || s.child.exitCode !== null || s.child.signalCode !== null || s.child.pid !== s.group) return;
    if (s.group !== undefined) try { process.kill(-s.group, signal); } catch { /* Confirmation below is mandatory even when kill fails. */ }
  }
  function write(s: Session, message: unknown): boolean {
    try {
      const line = `${JSON.stringify(message)}\n`;
      if (Buffer.byteLength(line) + s.child.stdin.writableLength > LIMIT || s.child.stdin.destroyed) return false;
      s.child.stdin.write(line, (error) => { if (error) fail(s, 'unavailable'); });
      return true;
    } catch { return false; }
  }
  function cleanup(s: Session): Promise<void> {
    if (s.cleanup) return s.cleanup;
    const wasStarting = s.phase === 'starting';
    freezeDiagnostic();
    s.phase = 'stopping';
    // Startup must not block the world while physical cleanup is quarantined.
    // Only answer settlement retains the scheduler's active slot until confirmation.
    if (wasStarting) s.startup.reject(new Error(s.failure ?? 'stopped'));
    if (s.watchdog) scheduler.clearTimeout(s.watchdog);
    s.startup.clear(); s.answer?.clear();
    write(s, { op: 'stop' });
    s.cleanup = (async () => {
      // Give the worker time to reap its runner, then escalate within the usual 2 s window.
      const began = runtime.monotonicNow();
      let term = false; let kill = false;
      for (;;) {
        const elapsed = runtime.monotonicNow() - began;
        if (!term && elapsed >= 100) { term = true; signalGroup(s, 'SIGTERM'); }
        if (!kill && elapsed >= 500) { kill = true; signalGroup(s, 'SIGKILL'); }
        let alive = true;
        try { alive = s.group !== undefined && await runtime.groupAlive(s.group); } catch { /* Unknown means still owned: quarantine, not a released slot. */ }
        if (s.exited && !alive) break;
        await delay(50);
      }
      s.child.stdin.destroy(); s.child.stdout.destroy(); s.child.stderr.destroy();
      if (owned === s) owned = undefined;
      const error = new Error(s.failure ?? 'stopped');
      s.startup.reject(error); s.answer?.reject(error); s.answer = undefined;
    })();
    return s.cleanup;
  }
  function fail(s: Session, reason: Failure): void {
    if (s.phase === 'stopping') return;
    s.failure = reason; lastFailure = reason;
    void cleanup(s);
  }
  function ready(s: Session): void {
    if (s.phase !== 'starting' || !s.readyReceived || !s.measured) return;
    if (s.startupExpired()) { fail(s, 'startup_timeout'); return; }
    s.phase = 'ready'; lastFailure = undefined; s.startup.clear(); s.startup.resolve();
  }
  async function watch(s: Session): Promise<void> {
    let timer: TimerHandle | undefined;
    try {
      const bytes = await Promise.race([
        runtime.memoryBytes(s.group!),
        new Promise<never>((_resolve, reject) => { timer = scheduler.setTimeout(() => reject(new Error('memory_sample_deadline')), 600); }),
      ]);
      if (s.phase === 'stopping') return;
      if (!Number.isSafeInteger(bytes) || bytes <= 0) { fail(s, 'memory_sample_invalid'); return; }
      if (bytes >= SOFT_RSS) { fail(s, 'resource_limit'); return; }
      s.measured = true; ready(s);
    } catch (error) {
      const reason = error instanceof Error && isNpcFailureCode(error.message) && error.message.startsWith('memory_sample_')
        ? error.message : 'memory_unavailable';
      fail(s, reason);
    }
    finally { if (timer) scheduler.clearTimeout(timer); }
    if (s.phase !== 'stopping') s.watchdog = scheduler.setTimeout(() => { void watch(s); }, 250);
  }
  function output(s: Session, chunk: Buffer): void {
    if (s.phase === 'stopping') return;
    // Idle bytes cannot belong to a future request, even without a newline.
    if (s.readyReceived && !s.answer) { fail(s, 'protocol_error'); return; }
    s.outputBytes += chunk.length;
    if (s.outputBytes > LIMIT) { fail(s, 'output_limit'); return; }
    s.buffer = Buffer.concat([s.buffer, chunk]);
    const newline = s.buffer.indexOf(10);
    if (newline < 0) return;
    // Validate the entire available batch before publishing diagnostics or settling a terminal.
    // Progress can coalesce with an answer. A valid terminal prefix plus any extra bytes cannot.
    let offset = 0;
    let count = s.messageCount;
    let nextDiagnostic = diagnostic;
    let terminal: Record<string, unknown> | undefined;
    let error: Failure | undefined;
    const pending = s.answer;
    const integer = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
    try {
      for (let end = newline; end >= 0; end = s.buffer.indexOf(10, offset)) {
        if (++count > 12 || terminal) throw new Error();
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(s.buffer.subarray(offset, end)));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        const message = parsed as Record<string, unknown>;
        const lineBytes = end - offset;
        offset = end + 1;
        if (message.type === 'progress') {
          if (lineBytes > 512) throw new Error();
          if (backend !== 'ollama' || s.phase !== 'ready' || !pending || !nextDiagnostic) throw new Error();
          if (message.stage === 'prefill') {
            if (nextDiagnostic.stage !== 'preparing' || Object.keys(message).length !== 3 || !integer(message.promptTokens, 1792)) throw new Error();
            nextDiagnostic = { stage: 'prefill', elapsedMs: 0, promptTokens: message.promptTokens };
          } else if (message.stage === 'decoding' || message.stage === 'complete') {
            if (!['prefill', 'decoding'].includes(nextDiagnostic.stage) || Object.keys(message).length !== 3 || !integer(message.outputChunks, 4096)) throw new Error();
            const previous = nextDiagnostic.outputChunks ?? 0;
            if (nextDiagnostic.stage === 'prefill' && (message.stage !== 'decoding' || message.outputChunks !== 1)) throw new Error();
            if (message.stage === 'decoding' ? message.outputChunks <= previous : message.outputChunks < previous) throw new Error();
            nextDiagnostic = { ...nextDiagnostic, stage: message.stage, outputChunks: message.outputChunks,
              ...(message.stage === 'decoding' && nextDiagnostic.firstTokenMs === undefined ? { firstTokenMs: elapsed() } : {}) };
          } else throw new Error();
          continue;
        }
        terminal = message;
        if (message.type === 'error') {
          // Never expose arbitrary worker output, paths, prompts or stderr.
          if (typeof message.code !== 'string' || typeof message.message !== 'string' || Buffer.byteLength(message.message) > 1024) throw new Error();
          error = isNpcFailureCode(message.diagnostic) && message.diagnostic.startsWith('ollama_')
            ? message.diagnostic : failures.has(message.code as Failure) ? message.code as Failure : 'unavailable';
        } else if (s.phase === 'starting' && message.type === 'ready' && Object.keys(message).length === 1 && !s.readyReceived) {
          // Initial memory admission still gates ready() below.
        } else {
          if (s.phase !== 'ready' || !pending || message.type !== 'answer' || typeof message.text !== 'string' || Object.keys(message).length !== 2) throw new Error();
          if (Buffer.byteLength(message.text) > TEXT_LIMIT) { error = 'output_limit'; }
          else if (!message.text.trim() || /<\s*\/?\s*(?:think|analysis)\b/i.test(message.text)) throw new Error();
          if (nextDiagnostic && !['preparing', 'complete'].includes(nextDiagnostic.stage)) throw new Error();
        }
      }
      if (terminal && offset !== s.buffer.length) throw new Error();
    } catch { fail(s, 'protocol_error'); return; }
    s.messageCount = count;
    s.buffer = s.buffer.subarray(offset);
    diagnostic = nextDiagnostic;
    // Progress never resets the deadline or releases an aborted generation.
    if (pending?.aborted()) { fail(s, 'aborted'); return; }
    if (pending?.expired()) { fail(s, 'timeout'); return; }
    if (error) { fail(s, error); return; }
    if (!terminal) return;
    if (terminal.type === 'ready') { s.readyReceived = true; ready(s); return; }
    answerAccepted = true;
    if (diagnostic) { diagnostic = { ...diagnostic, stage: 'complete' }; freezeDiagnostic(); }
    pending!.clear(); s.answer = undefined;
    pending!.resolve({ text: terminal.text as string });
  }
  async function start(): Promise<void> {
    if (starting) return starting;
    if (owned?.phase === 'ready') return;
    // Never await unconfirmed cleanup on the startup path or launch a late replacement.
    if (owned) throw new Error('unavailable');
    if ((backend === 'mlx' && (runtime.platform !== 'darwin' || runtime.arch !== 'arm64')) ||
        (backend === 'ollama' && (!['darwin', 'linux'].includes(runtime.platform) || !['x64', 'arm64'].includes(runtime.arch)))) {
      lastFailure = 'unsupported_platform'; throw new Error('unsupported_platform');
    }
    diagnostic = undefined; diagnosticEnd = undefined;
    const env = {
      ...process.env,
      PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: '',
      HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1',
      DO_NOT_TRACK: '1', TOKENIZERS_PARALLELISM: 'false', WANDB_DISABLED: 'true', OLLAMA_NO_CLOUD: '1',
      OMP_NUM_THREADS: String(options.threads), OPENBLAS_NUM_THREADS: String(options.threads), MKL_NUM_THREADS: String(options.threads), VECLIB_MAXIMUM_THREADS: String(options.threads), NUMEXPR_NUM_THREADS: String(options.threads),
    };
    let resolve!: () => void; let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    starting = promise;
    const began = runtime.monotonicNow(); const wall = clock.now(); const timeout = Number(options.startupTimeoutMs);
    let timer: TimerHandle | undefined;
    let child: ChildProcessWithoutNullStreams;
    try { child = spawn(String(options.python), [...(runtime.workerPrefix ?? ['-u', '-B']), runtime.workerPath], { shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env }); }
    catch { starting = undefined; lastFailure = 'unavailable'; throw new Error('unavailable'); }
    const s: Session = {
      child, group: child.pid, exited: false, phase: 'starting', buffer: Buffer.alloc(0), outputBytes: 0, messageCount: 0, stderrBytes: 0, readyReceived: false, measured: false,
      startup: { resolve, reject, clear: () => { if (timer) scheduler.clearTimeout(timer); } },
      startupExpired: () => clock.now() - wall >= timeout || runtime.monotonicNow() - began >= timeout,
    };
    owned = s;
    child.on('error', () => { if (child.pid === undefined) s.exited = true; fail(s, 'unavailable'); });
    child.on('exit', () => { s.exited = true; fail(s, 'unavailable'); });
    child.stdin.on('error', () => fail(s, 'unavailable'));
    child.stdout.on('error', () => fail(s, 'unavailable'));
    child.stdout.on('end', () => fail(s, 'unavailable'));
    child.stderr.on('error', () => fail(s, 'unavailable'));
    child.stdout.on('data', (chunk: Buffer) => output(s, chunk));
    child.stderr.on('data', (chunk: Buffer) => { s.stderrBytes += chunk.length; if (s.stderrBytes > LIMIT) fail(s, 'output_limit'); });
    timer = scheduler.setTimeout(() => fail(s, 'startup_timeout'), timeout);
    if (!write(s, { op: 'start', options })) fail(s, 'input_too_long');
    if (child.pid !== undefined) void watch(s);
    try { await promise; } finally { if (starting === promise) starting = undefined; }
  }
  return {
    start,
    async stop() { if (owned) { if (!owned.failure) { owned.failure = 'stopped'; lastFailure = 'stopped'; } await cleanup(owned); } },
    status: () => owned?.phase === 'ready' ? 'ready' : 'unavailable',
    lastFailure: () => lastFailure,
    diagnostics: () => diagnostic ? { ...diagnostic, elapsedMs: elapsed(),
      stage: diagnostic.stage === 'complete' && !answerAccepted ? (diagnostic.outputChunks ? 'decoding' : 'prefill') : diagnostic.stage } : undefined,
    answer(request: NpcAnswerRequest, signal: AbortSignal): Promise<{ text: string }> {
      const s = owned;
      if (!s || s.phase !== 'ready') return Promise.reject(new Error('unavailable'));
      if (s.answer) return Promise.reject(new Error('busy'));
      const began = runtime.monotonicNow();
      diagnosticBegan = began; diagnosticEnd = undefined; answerAccepted = false;
      diagnostic = backend === 'ollama' ? { stage: 'preparing', elapsedMs: 0 } : undefined;
      const remaining = Math.min(runtime.answerCeilingMs, request.deadlineAt - clock.now());
      let timer: TimerHandle | undefined;
      const abort = () => fail(s, 'aborted');
      const promise = new Promise<{ text: string }>((resolve, reject) => {
        s.answer = {
          resolve, reject,
          expired: () => !Number.isFinite(remaining) || clock.now() >= request.deadlineAt || runtime.monotonicNow() - began >= remaining,
          aborted: () => signal.aborted,
          clear: () => { if (timer) scheduler.clearTimeout(timer); signal.removeEventListener('abort', abort); },
        };
      });
      if (signal.aborted) { fail(s, 'aborted'); return promise; }
      if (!Number.isFinite(remaining) || remaining <= 0) { fail(s, 'timeout'); return promise; }
      signal.addEventListener('abort', abort, { once: true });
      timer = scheduler.setTimeout(() => fail(s, 'timeout'), remaining);
      s.outputBytes = 0; s.messageCount = 0; s.stderrBytes = 0;
      const bounded = boundedRequest(request);
      if (!bounded || !write(s, { op: 'answer', request: bounded })) fail(s, 'input_too_long');
      return promise;
    },
  };
}
