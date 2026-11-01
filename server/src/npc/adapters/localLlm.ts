import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Clock, Scheduler, TimerHandle } from '../../common/time.ts';
import type { LocalTranslationRequest, NpcAnswerRequest, NpcDiagnostics, NpcResponder } from '../NpcResponder.ts';
import { isNpcFailureCode, type NpcFailureCode } from '../failureCodes.ts';
import { NPC_TIMING } from '../../../../shared/protocol/npcTiming.ts';
import { hasObviousCyrillicReply } from '../targetLanguage.ts';

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

/** Validate local runtime options without starting a process or reading artifacts. */
export function validateLocalLlmOptions(backend: Backend, input: Record<string, unknown>): Record<string, unknown> {
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
function validUnicode(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const next = text.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
// Pinned from Node 24.22.2 / Unicode 17.0: Extended_Pictographic |
// Emoji_Presentation | Emoji_Modifier | Regional_Indicator. Keep Python's table identical.
const EMOJI_RANGES = 'a9,ae,203c,2049,2122,2139,2194-2199,21a9-21aa,231a-231b,2328,23cf,23e9-23f3,23f8-23fa,24c2,25aa-25ab,25b6,25c0,25fb-25fe,2600-2604,260e,2611,2614-2615,2618,261d,2620,2622-2623,2626,262a,262e-262f,2638-263a,2640,2642,2648-2653,265f-2660,2663,2665-2666,2668,267b,267e-267f,2692-2697,2699,269b-269c,26a0-26a1,26a7,26aa-26ab,26b0-26b1,26bd-26be,26c4-26c5,26c8,26ce-26cf,26d1,26d3-26d4,26e9-26ea,26f0-26f5,26f7-26fa,26fd,2702,2705,2708-270d,270f,2712,2714,2716,271d,2721,2728,2733-2734,2744,2747,274c,274e,2753-2755,2757,2763-2764,2795-2797,27a1,27b0,27bf,2934-2935,2b05-2b07,2b1b-2b1c,2b50,2b55,3030,303d,3297,3299,1f004,1f02c-1f02f,1f094-1f09f,1f0af-1f0b0,1f0c0,1f0cf-1f0d0,1f0f6-1f0ff,1f170-1f171,1f17e-1f17f,1f18e,1f191-1f19a,1f1ae-1f1ff,1f201-1f20f,1f21a,1f22f,1f232-1f23a,1f23c-1f23f,1f249-1f25f,1f266-1f321,1f324-1f393,1f396-1f397,1f399-1f39b,1f39e-1f3f0,1f3f3-1f3f5,1f3f7-1f4fd,1f4ff-1f53d,1f549-1f54e,1f550-1f567,1f56f-1f570,1f573-1f57a,1f587,1f58a-1f58d,1f590,1f595-1f596,1f5a4-1f5a5,1f5a8,1f5b1-1f5b2,1f5bc,1f5c2-1f5c4,1f5d1-1f5d3,1f5dc-1f5de,1f5e1,1f5e3,1f5e8,1f5ef,1f5f3,1f5fa-1f64f,1f680-1f6c5,1f6cb-1f6d2,1f6d5-1f6e5,1f6e9,1f6eb-1f6f0,1f6f3-1f6ff,1f7da-1f7ff,1f80c-1f80f,1f848-1f84f,1f85a-1f85f,1f888-1f88f,1f8ae-1f8af,1f8bc-1f8bf,1f8c2-1f8cf,1f8d9-1f8ff,1f90c-1f93a,1f93c-1f945,1f947-1f9ff,1fa58-1fa5f,1fa6e-1faff,1fc00-1fffd';
const emojiIntervals = EMOJI_RANGES.split(',').map(item => {
  const parts = item.split('-').map(value => parseInt(value, 16));
  return [parts[0]!, parts[parts.length - 1]!] as const;
});
function emojiLike(text: string): boolean {
  // Keep standalone ZWJ for script shaping. VS16 and keycap sequences are emoji-like.
  if (/\ufe0f|[0-9#*]\ufe0f?\u20e3/u.test(text)) return true;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    if (emojiIntervals.some(([start, end]) => point >= start && point <= end)) return true;
  }
  return false;
}
function validTargetText(text: string): boolean {
  return validUnicode(text) && [...text].length <= 800 && !emojiLike(text) && !hasObviousCyrillicReply(text);
}
function boundedRequest(request: NpcAnswerRequest): NpcAnswerRequest | undefined {
  if (!request || !request.npc || !Array.isArray(request.history) || !['ru', 'en', 'es'].includes(request.locale) || !Number.isFinite(request.deadlineAt)) return;
  const { requestKey, playerId, playerName, question, locale, deadlineAt } = request;
  const { id, name, topic, persona, greeting } = request.npc;
  if (![requestKey, playerId, playerName, question, id, name, topic, persona, greeting].every((value) => typeof value === 'string')) return;
  if (Buffer.byteLength(question) > 4096 || (locale !== 'ru' && (!validUnicode(question) || [...question].length > 800 || !question.trim()))) return;
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

function boundedTranslation(request: LocalTranslationRequest): Omit<LocalTranslationRequest, 'requestKey'> | undefined {
  if (!request || typeof request.requestKey !== 'string' || !request.requestKey || request.requestKey.length > 4096 ||
      typeof request.text !== 'string' || !request.text.trim() || request.text.length > 500 || !validUnicode(request.text) ||
      /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(request.text) || Buffer.byteLength(request.text) > 4096 ||
      !['ru', 'en', 'es'].includes(request.source) || !['ru', 'en', 'es'].includes(request.target) || !Number.isFinite(request.deadlineAt)) return;
  const safe = { text: request.text, source: request.source, target: request.target, deadlineAt: request.deadlineAt };
  if (jsonBytes({ op: 'translate', request: safe }) + 1 > LIMIT) return;
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
  answer?: Pending & { resolve(value: { text: string }): void; expired(): boolean; aborted(): boolean; mode: 'legacy' | 'target' | 'translation' };
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
  return build(backend, validateLocalLlmOptions(backend, options), deps, {
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
  return build('ollama', validateLocalLlmOptions('ollama', options), deps, {
    workerPath: fileURLToPath(new URL('../../../llm/ollama_worker.py', import.meta.url)),
    platform: process.platform, arch: process.arch, monotonicNow: () => performance.now(), memoryBytes, groupAlive,
  });
}
export function localLlmForTest(backend: Backend, options: Record<string, unknown>, deps: Deps, runtime: Partial<Runtime> & Pick<Runtime, 'workerPath'>): LocalLlmResponder {
  return build(backend, validateLocalLlmOptions(backend, options), deps, {
    platform: process.platform, arch: process.arch, monotonicNow: () => performance.now(), memoryBytes, groupAlive, ...runtime,
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
    return Number.isFinite(value) ? Math.max(0, Math.min(NPC_TIMING.maxMs, Math.floor(value))) : 0;
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
          if (s.phase !== 'ready' || !pending || message.type !== (pending.mode === 'translation' ? 'translation' : 'answer') || typeof message.text !== 'string') throw new Error();
          if (pending.mode !== 'legacy' ? Object.keys(message).length !== 3 || message.finishReason !== 'stop' : Object.keys(message).length !== 2) throw new Error();
          if (Buffer.byteLength(message.text) > TEXT_LIMIT) { error = 'output_limit'; }
          else if (!message.text.trim() || /<\s*\/?\s*(?:think|analysis)\b/i.test(message.text) || (pending.mode === 'target' && !validTargetText(message.text)) ||
              (pending.mode === 'translation' && (!validUnicode(message.text) || message.text.length > 4000 || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(message.text)))) throw new Error();
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
  function execute(request: NpcAnswerRequest | LocalTranslationRequest, signal: AbortSignal, operation: 'answer' | 'translate'): Promise<{ text: string }> {
      const s = owned;
      if (!s || s.phase !== 'ready') return Promise.reject(new Error('unavailable'));
      if (s.answer) return Promise.reject(new Error('busy'));
      const began = runtime.monotonicNow();
      diagnosticBegan = began; diagnosticEnd = undefined; answerAccepted = false;
      diagnostic = backend === 'ollama' ? { stage: 'preparing', elapsedMs: 0 } : undefined;
      const remaining = request.deadlineAt - clock.now();
      let timer: TimerHandle | undefined;
      const abort = () => fail(s, 'aborted');
      const promise = new Promise<{ text: string }>((resolve, reject) => {
        s.answer = {
          resolve, reject,
          expired: () => !Number.isFinite(remaining) || clock.now() >= request.deadlineAt || runtime.monotonicNow() - began >= remaining,
          aborted: () => signal.aborted,
          mode: operation === 'translate' ? 'translation' : ((request as NpcAnswerRequest).locale === 'ru' ? 'legacy' : 'target'),
          clear: () => { if (timer) scheduler.clearTimeout(timer); signal.removeEventListener('abort', abort); },
        };
      });
      if (signal.aborted) { fail(s, 'aborted'); return promise; }
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > NPC_TIMING.maxMs) { fail(s, 'timeout'); return promise; }
      signal.addEventListener('abort', abort, { once: true });
      timer = scheduler.setTimeout(() => fail(s, 'timeout'), remaining);
      s.outputBytes = 0; s.messageCount = 0; s.stderrBytes = 0;
      const bounded = operation === 'answer' ? boundedRequest(request as NpcAnswerRequest) : boundedTranslation(request as LocalTranslationRequest);
      if (!bounded || !write(s, { op: operation, request: bounded })) fail(s, 'input_too_long');
      return promise;
  }
  return {
    start,
    async stop() { if (owned) { if (!owned.failure) { owned.failure = 'stopped'; lastFailure = 'stopped'; } await cleanup(owned); } },
    status: () => owned?.phase === 'ready' ? 'ready' : 'unavailable',
    lastFailure: () => lastFailure,
    diagnostics: () => diagnostic ? { ...diagnostic, elapsedMs: elapsed(),
      stage: diagnostic.stage === 'complete' && !answerAccepted ? (diagnostic.outputChunks ? 'decoding' : 'prefill') : diagnostic.stage } : undefined,
    answer: (request: NpcAnswerRequest, signal: AbortSignal) => execute(request, signal, 'answer'),
    translate: (request: LocalTranslationRequest, signal: AbortSignal) => execute(request, signal, 'translate'),
  };
}
