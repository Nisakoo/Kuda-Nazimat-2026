import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NpcAnswerRequest, NpcDiagnostics, NpcResponder } from '../src/npc/NpcResponder.ts';
import type { Clock, Scheduler } from '../src/common/time.ts';
// @ts-expect-error The operator entrypoint is intentionally standalone JavaScript.
import { runDiagnostic as runUntyped } from '../llm/diagnose.mjs';

type Options = {
  configPath: string;
  profilesPath?: string;
  factory: (options: Record<string, unknown>, deps: { clock: Clock; scheduler: Scheduler }) => NpcResponder | Promise<NpcResponder>;
  writeLine: (line: string) => void;
  signal?: AbortSignal;
  onInterrupt?: (callback: () => void) => () => void;
};
const runDiagnostic = runUntyped as (options: Options) => Promise<number>;
const contentDir = fileURLToPath(new URL('../content/', import.meta.url));
const script = fileURLToPath(new URL('../llm/diagnose.mjs', import.meta.url));
const dirs: string[] = [];
const servers: Server[] = [];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function listen(host = '127.0.0.1'): Promise<{ server: Server; port: number }> {
  const server = createServer(); servers.push(server);
  await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, host, yes); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture address');
  return { server, port: address.port };
}
async function close(server: Server) {
  if (server.listening) await new Promise<void>((yes, no) => server.close((error) => error ? no(error) : yes()));
}
async function fixture(overrides: Record<string, unknown> = {}) {
  const game = await listen(); const native = await listen();
  const dir = await mkdtemp(join(tmpdir(), 'llm-diagnostic-')); dirs.push(dir);
  const configPath = join(dir, 'config.json');
  const config = { port: game.port, contentDir, npc: { adapter: 'ollama', timeoutMs: 8000, options: { port: native.port } }, ...overrides };
  await writeFile(configPath, JSON.stringify(config));
  await close(game.server); await close(native.server);
  return { configPath, dir, gamePort: game.port, nativePort: native.port, original: JSON.stringify(config) };
}
function harness() {
  const lines: string[] = [];
  const responder = {
    start: vi.fn(async () => {}),
    answer: vi.fn(async (_request: NpcAnswerRequest, _signal: AbortSignal) => ({ text: 'Здравствуй! Какой узор тебе нравится?' })),
    stop: vi.fn(async () => {}),
    lastFailure: vi.fn((): string | undefined => undefined),
    diagnostics: vi.fn((): NpcDiagnostics | undefined => undefined),
  };
  const factory = vi.fn((_options: Record<string, unknown>, _deps: { clock: Clock; scheduler: Scheduler }) => responder);
  const writeLine = (line: string) => { lines.push(line); };
  const events = () => lines.filter((line) => line.startsWith('{')).map((line) => JSON.parse(line) as Record<string, unknown>);
  return { responder, factory, lines, writeLine, events };
}

afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) await close(server);
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('operator diagnostic (fake responders only; no models or worker processes)', () => {
  it('has no import-time execution or signal handlers', () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e',
      `const n=['SIGINT','SIGTERM','SIGHUP'].map(s=>process.listenerCount(s)); await import(${JSON.stringify(script)}); console.log(['SIGINT','SIGTERM','SIGHUP'].map((s,i)=>process.listenerCount(s)-n[i]).join(','));`], { encoding: 'utf8' });
    expect(output).toBe('0,0,0\n');
  });

  it('uses the same saved prepared profile as the game, not stale legacy model options', async () => {
    const f = await fixture(); const h = harness();
    const python = join(f.dir, 'python'); const executable = join(f.dir, 'ollama');
    await writeFile(python, 'fixture only, never executed', { mode: 0o700 });
    await writeFile(executable, 'fixture only, never executed', { mode: 0o700 });
    const modelsDir = join(f.dir, 'models');
    const manifests = join(modelsDir, 'manifests-v2/ollama.com/library/qwen3.5');
    await mkdir(manifests, { recursive: true });
    const metadata = await readFile(new URL('../llm/fixtures/qwen35-2b-active-manifest.json', import.meta.url));
    const profiles = [];
    for (const [model, tag] of [['2b', '2b-q4_K_M'], ['0.8b', '0.8b-q8_0']]) {
      const tokenizerDir = join(f.dir, `tokenizer-${model}`); await mkdir(tokenizerDir);
      await writeFile(join(tokenizerDir, 'tokenizer.json'), '{}');
      const tokenizerManifest = join(f.dir, `inventory-${model}.json`);
      await writeFile(tokenizerManifest, JSON.stringify({ 'tokenizer.json': 'a'.repeat(64) }));
      await writeFile(join(manifests, tag!), metadata);
      profiles.push({ backend: 'ollama', model, options: { python, executable, modelsDir, tokenizerDir, tokenizerManifest,
        model: `qwen3.5:${tag}`, modelDigest: 'a'.repeat(64), runnerVersion: '0.40.13', port: f.nativePort } });
    }
    const profilesPath = join(f.dir, 'profiles.json');
    const catalog = JSON.stringify({ version: 1, selected: { backend: 'ollama', model: '2b' }, profiles });
    await writeFile(profilesPath, catalog);
    expect(await runDiagnostic({ ...h, configPath: f.configPath, profilesPath })).toBe(0);
    expect(h.factory.mock.calls[0]![0]).toMatchObject({ model: 'qwen3.5:2b-q4_K_M', tokenizerDir: join(f.dir, 'tokenizer-2b') });
    expect(h.events()[0]).toEqual({ event: 'selection', backend: 'ollama', model: '2b', timeoutMs: 8000 });
    expect(await readFile(profilesPath, 'utf8')).toBe(catalog);
    expect(await readFile(f.configPath, 'utf8')).toBe(f.original);
  });

  it('refuses an explicit missing profile catalog before creating a responder', async () => {
    const f = await fixture(); const h = harness();
    expect(await runDiagnostic({ ...h, configPath: f.configPath, profilesPath: join(f.dir, 'missing.json') })).toBe(1);
    expect(h.events()).toEqual([{ event: 'failure', code: 'config_invalid' }]);
    expect(h.factory).not.toHaveBeenCalled();
  });

  it('refuses an occupied game port before constructing or starting a responder', async () => {
    const f = await fixture(); const h = harness();
    const occupied = createServer(); servers.push(occupied);
    await new Promise<void>((yes, no) => { occupied.once('error', no); occupied.listen(f.gamePort, '127.0.0.1', yes); });
    expect(await runDiagnostic({ ...h, configPath: f.configPath })).toBe(1);
    expect(h.events()).toEqual([{ event: 'failure', code: 'game_port_unavailable' }]);
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.responder.start).not.toHaveBeenCalled();
    expect(occupied.listening).toBe(true); // No killing or closing another listener.
  });

  it('refuses an occupied native port before constructing or starting a responder', async () => {
    const f = await fixture(); const h = harness();
    const occupied = createServer(); servers.push(occupied);
    await new Promise<void>((yes, no) => { occupied.once('error', no); occupied.listen(f.nativePort, '127.0.0.1', yes); });
    expect(await runDiagnostic({ ...h, configPath: f.configPath })).toBe(1);
    expect(h.events()).toEqual([{ event: 'failure', code: 'native_port_unavailable' }]);
    expect(h.factory).not.toHaveBeenCalled();
    expect(occupied.listening).toBe(true);
  });

  it.each([
    [{ npc: { adapter: 'mlx', options: {} } }, 'adapter_required'],
    [{ npc: { adapter: 'scripted', options: {} } }, 'adapter_required'],
    [{ npc: { adapter: 'ollama', options: { port: 'secret-path' } } }, 'config_invalid'],
    [{ npc: { adapter: 'ollama', timeoutMs: 30001, options: {} } }, 'config_invalid'],
    [{ port: 0 }, 'config_invalid'],
  ])('refuses invalid adapter/config with a fixed error (%j)', async (overrides, code) => {
    const f = await fixture(overrides); const h = harness();
    expect(await runDiagnostic({ ...h, configPath: f.configPath })).toBe(1);
    expect(h.events()).toEqual([{ event: 'failure', code }]);
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.lines.join()).not.toContain('secret-path');
  });

  it('refuses unreadable or malformed config without exposing its path or raw error', async () => {
    const f = await fixture(); const h = harness();
    await writeFile(f.configPath, '{secret-malformed');
    expect(await runDiagnostic({ ...h, configPath: f.configPath })).toBe(1);
    expect(h.events()).toEqual([{ event: 'failure', code: 'config_invalid' }]);
    await rm(f.configPath);
    expect(await runDiagnostic({ ...h, configPath: f.configPath })).toBe(1);
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.lines.join()).not.toMatch(/secret-malformed|ENOENT|config\.json/);
  });

  it.each(['missing', 'invalid'])('validates the trusted fabric profile (%s)', async (kind) => {
    const f = await fixture(); const h = harness();
    const content = JSON.parse(await readFile(join(contentDir, 'npcs.json'), 'utf8')) as Record<string, unknown>[];
    if (kind === 'missing') content.splice(content.findIndex((npc) => npc.id === 'fabric-seller'), 1);
    else content.find((npc) => npc.id === 'fabric-seller')!.persona = 12;
    await writeFile(join(f.dir, 'npcs.json'), JSON.stringify(content));
    await writeFile(f.configPath, JSON.stringify({ port: f.gamePort, contentDir: f.dir, npc: { adapter: 'ollama', options: { port: f.nativePort } } }));
    expect(await runDiagnostic({ ...h, configPath: f.configPath })).toBe(1);
    expect(h.events()).toEqual([{ event: 'failure', code: 'content_invalid' }]);
    expect(h.factory).not.toHaveBeenCalled();
  });

  it('asks exactly once with the existing profile, empty history and a separate 30s deadline; stops and leaves config unchanged', async () => {
    const f = await fixture(); const h = harness();
    h.responder.answer.mockImplementation(async (request) => {
      expect(request.deadlineAt - Date.now()).toBeGreaterThanOrEqual(29900);
      expect(request.deadlineAt - Date.now()).toBeLessThanOrEqual(30000);
      h.responder.diagnostics.mockReturnValue({ stage: 'complete', elapsedMs: 24, firstTokenMs: 12, promptTokens: 161, outputChunks: 3 });
      return { text: 'Здравствуй! Какой узор тебе нравится?' };
    });
    expect(await runDiagnostic({ ...h, configPath: f.configPath })).toBe(0);
    const content = JSON.parse(await readFile(join(contentDir, 'npcs.json'), 'utf8')) as Record<string, unknown>[];
    const { id, name, topic, persona, greeting } = content.find((npc) => npc.id === 'fabric-seller')!;
    expect(h.responder.answer).toHaveBeenCalledTimes(1);
    const [request, signal] = h.responder.answer.mock.calls[0]!;
    expect(request).toMatchObject({ npc: { id, name, topic, persona, greeting }, question: 'Привет!', history: [], locale: 'ru' });
    expect(Object.keys(request.npc).sort()).toEqual(['greeting', 'id', 'name', 'persona', 'topic']);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(h.factory.mock.calls[0]![0]).toEqual({ port: f.nativePort });
    expect(h.factory.mock.calls[0]![1].clock.now()).toBeGreaterThan(0);
    expect(h.responder.stop).toHaveBeenCalledTimes(1);
    expect(h.events()).toContainEqual({ event: 'response', text: 'Здравствуй! Какой узор тебе нравится?', truncated: 0 });
    expect(h.events()).toContainEqual(expect.objectContaining({ event: 'ready', elapsedMs: expect.any(Number) }));
    expect(h.events()).toContainEqual(expect.objectContaining({ event: 'final', elapsedMs: 24, firstTokenMs: 12, firstTextElapsedMs: expect.any(Number), promptTokens: 161, outputChunks: 3 }));
    expect(h.events().at(-1)).toMatchObject({ event: 'cleanup_confirmed' });
    expect(await readFile(f.configPath, 'utf8')).toBe(f.original);
  });

  it('bounds response output and escapes terminal control characters', async () => {
    const f = await fixture(); const h = harness();
    h.responder.answer.mockResolvedValue({ text: '\u001b[31m' + 'я'.repeat(3000) });
    expect(await runDiagnostic({ ...h, configPath: f.configPath })).toBe(0);
    const answer = h.events().find((event) => event.event === 'response')!;
    expect(Array.from(answer.text as string)).toHaveLength(2048);
    expect(answer.truncated).toBe(1);
    expect(h.lines.join()).not.toContain('\u001b');
    expect(h.responder.stop).toHaveBeenCalledTimes(1);
  });

  it.each(['resource_limit', 'timeout', '/private/secret raw exception'])('uses only allowlisted lastFailure, not an exception (%s)', async (reason) => {
    const f = await fixture(); const h = harness();
    h.responder.answer.mockRejectedValue(new Error('/private/secret exception'));
    h.responder.lastFailure.mockReturnValue(reason);
    expect(await runDiagnostic({ ...h, configPath: f.configPath })).toBe(1);
    expect(h.events()).toContainEqual({ event: 'failure', code: reason.startsWith('/') ? 'unavailable' : reason });
    expect(h.lines.join()).not.toContain('/private/secret');
    expect(h.responder.stop).toHaveBeenCalledTimes(1);
    expect(h.events()).not.toContainEqual(expect.objectContaining({ event: 'response' }));
  });

  it('stops after startup failure and masks factory validation details', async () => {
    const f = await fixture(); const h = harness();
    h.responder.start.mockRejectedValue(new Error('private startup detail'));
    h.responder.lastFailure.mockReturnValue('ollama_model_integrity');
    expect(await runDiagnostic({ ...h, configPath: f.configPath })).toBe(1);
    expect(h.events()).toContainEqual({ event: 'failure', code: 'ollama_model_integrity' });
    expect(h.responder.answer).not.toHaveBeenCalled();
    expect(h.responder.stop).toHaveBeenCalledTimes(1);
    const other = harness();
    other.factory.mockImplementation(() => { throw new Error('private path'); });
    expect(await runDiagnostic({ ...other, configPath: f.configPath })).toBe(1);
    expect(other.events()).toEqual([{ event: 'failure', code: 'config_invalid' }]);
    expect(other.lines.join()).not.toContain('private');
  });

  it('does not start when already cancelled', async () => {
    const f = await fixture(); const h = harness(); const controller = new AbortController();
    controller.abort();
    expect(await runDiagnostic({ ...h, configPath: f.configPath, signal: controller.signal })).toBe(1);
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.events()).toEqual([{ event: 'failure', code: 'aborted' }]);
  });

  it('waits for readiness before starting the 30s answer timer and emits bounded numeric progress', async () => {
    const f = await fixture(); const h = harness();
    vi.useFakeTimers();
    const starting = deferred<void>(); const enteredStart = deferred<void>();
    const answering = deferred<{ text: string }>(); const enteredAnswer = deferred<void>();
    h.responder.start.mockImplementation(() => { enteredStart.resolve(); return starting.promise; });
    h.responder.answer.mockImplementation((request) => {
      expect(request.deadlineAt).toBe(Date.now() + 30000);
      enteredAnswer.resolve(); return answering.promise;
    });
    const task = runDiagnostic({ ...h, configPath: f.configPath });
    await enteredStart.promise;
    await vi.advanceTimersByTimeAsync(110000);
    expect(h.responder.answer).not.toHaveBeenCalled();
    expect(h.responder.stop).not.toHaveBeenCalled();
    starting.resolve(); await enteredAnswer.promise;
    h.responder.diagnostics.mockReturnValue({ stage: 'prefill', elapsedMs: 5, promptTokens: 161 });
    await vi.advanceTimersByTimeAsync(100);
    h.responder.diagnostics.mockReturnValue({ stage: 'decoding', elapsedMs: 12, promptTokens: 161, firstTokenMs: 12, outputChunks: 1 });
    await vi.advanceTimersByTimeAsync(1100);
    const progress = h.events().filter((event) => event.event === 'progress');
    expect(progress).toContainEqual(expect.objectContaining({ stage: 'prefill', promptTokens: 161 }));
    expect(progress.filter((event) => event.stage === 'decoding').length).toBeGreaterThanOrEqual(2);
    expect(progress.every((event) => typeof event.elapsedMs === 'number')).toBe(true);
    answering.resolve({ text: 'Здравствуй!' });
    expect(await task).toBe(0);
  });

  it('enforces a clear 30s timeout, aborts once and awaits stop confirmation', async () => {
    const f = await fixture(); const h = harness(); vi.useFakeTimers();
    const entered = deferred<void>();
    let answerSignal: AbortSignal | undefined;
    h.responder.answer.mockImplementation((_request, signal) => { answerSignal = signal; entered.resolve(); return new Promise(() => {}); });
    const task = runDiagnostic({ ...h, configPath: f.configPath });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(29999);
    expect(h.responder.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await task).toBe(1);
    expect(answerSignal?.aborted).toBe(true);
    expect(h.responder.stop).toHaveBeenCalledTimes(1);
    expect(h.events()).toContainEqual({ event: 'failure', code: 'timeout' });
    expect(h.events()).not.toContainEqual(expect.objectContaining({ event: 'response' }));
  });

  it.each(['starting', 'answering'])('Ctrl+C during %s joins stop; quarantine warns after 3s without a false cleanup or exit', async (when) => {
    const f = await fixture(); const h = harness(); vi.useFakeTimers();
    const entered = deferred<void>(); const stopped = deferred<void>();
    let interrupt!: () => void; const unsubscribe = vi.fn();
    const onInterrupt = (callback: () => void) => { interrupt = callback; return unsubscribe; };
    if (when === 'starting') h.responder.start.mockImplementation(() => { entered.resolve(); return new Promise(() => {}); });
    else h.responder.answer.mockImplementation(() => { entered.resolve(); return new Promise(() => {}); });
    h.responder.stop.mockImplementation(() => stopped.promise);
    let settled = false;
    const task = runDiagnostic({ ...h, configPath: f.configPath, onInterrupt }).then((code) => { settled = true; return code; });
    await entered.promise;
    interrupt(); await vi.advanceTimersByTimeAsync(2999);
    expect(h.lines.some((line) => line.includes('quarantined'))).toBe(false);
    interrupt(); await vi.advanceTimersByTimeAsync(1);
    expect(h.lines.filter((line) => line.includes('quarantined'))).toHaveLength(1);
    expect(settled).toBe(false);
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(h.responder.stop).toHaveBeenCalledTimes(1);
    expect(h.events()).not.toContainEqual(expect.objectContaining({ event: 'cleanup_confirmed' }));
    expect(h.events()).toContainEqual({ event: 'failure', code: 'aborted' });
    expect(h.events()).toContainEqual(expect.objectContaining({ event: 'final', elapsedMs: expect.any(Number) }));
    stopped.resolve();
    expect(await task).toBe(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.events().at(-1)).toMatchObject({ event: 'cleanup_confirmed' });
  });

  it.each(['SIGTERM', 'SIGHUP'] as const)('routes %s through owned stop and retains signal handlers until cleanup confirmation', async (name) => {
    const f = await fixture(); const h = harness(); vi.useFakeTimers();
    const oldInt = process.listeners('SIGINT'); const oldTerm = process.listeners(name);
    const oldHup = process.listeners('SIGHUP');
    const entered = deferred<void>(); const stopped = deferred<void>();
    let answerSignal: AbortSignal | undefined;
    h.responder.answer.mockImplementation((_request, signal) => { answerSignal = signal; entered.resolve(); return new Promise(() => {}); });
    h.responder.stop.mockImplementation(() => stopped.promise);
    const task = runDiagnostic({ ...h, configPath: f.configPath });
    await entered.promise;
    const term = process.listeners(name).find((listener) => !oldTerm.includes(listener));
    const int = process.listeners('SIGINT').find((listener) => !oldInt.includes(listener));
    expect(term).toBeTypeOf('function'); expect(int).toBe(term);
    // Call only the new listener. Never signal the test runner or invoke other listeners.
    term!(name); await vi.advanceTimersByTimeAsync(3000);
    int!('SIGINT'); await vi.advanceTimersByTimeAsync(0);
    expect(answerSignal?.aborted).toBe(true);
    expect(h.responder.stop).toHaveBeenCalledTimes(1);
    expect(process.listeners(name)).toContain(term);
    expect(process.listeners('SIGINT')).toContain(int);
    expect(h.events()).not.toContainEqual(expect.objectContaining({ event: 'cleanup_confirmed' }));
    stopped.resolve(); expect(await task).toBe(1);
    expect(process.listeners(name)).toEqual(oldTerm);
    expect(process.listeners('SIGINT')).toEqual(oldInt);
    expect(process.listeners('SIGHUP')).toEqual(oldHup);
  });

  it.each([
    ['starting', 'throw'], ['starting', 'error'], ['starting', 'close'],
    ['answering', 'throw'], ['answering', 'error'], ['answering', 'close'],
  ])('awaits owned stop when output fails during %s (%s), without retries or leaked exceptions', async (when, kind) => {
    const f = await fixture(); const h = harness(); vi.useFakeTimers();
    const oldErrors = process.stdout.listeners('error'); const oldClose = process.stdout.listeners('close');
    const oldHup = process.listeners('SIGHUP');
    const entered = deferred<void>(); const stopped = deferred<void>();
    if (when === 'starting') h.responder.start.mockImplementation(() => { entered.resolve(); return new Promise(() => {}); });
    else h.responder.answer.mockImplementation(() => { entered.resolve(); return new Promise(() => {}); });
    h.responder.stop.mockImplementation(() => stopped.promise);
    let broken = false;
    const writeLine = vi.fn((line: string) => {
      if (broken) throw new Error('/private/original-output-exception');
      h.writeLine(line);
    });
    let settled = false;
    const task = runDiagnostic({ ...h, writeLine, configPath: f.configPath }).then((code) => { settled = true; return code; });
    await entered.promise;
    const errorListener = process.stdout.listeners('error').find((listener) => !oldErrors.includes(listener));
    const closeListener = process.stdout.listeners('close').find((listener) => !oldClose.includes(listener));
    if (kind === 'throw') {
      broken = true; await vi.advanceTimersByTimeAsync(1000);
    } else if (kind === 'error') {
      // Call only our error listener. Do not emit an error on the test runner's stdout.
      errorListener!(Object.assign(new Error('/private/original-output-exception'), { code: 'EPIPE' }));
    } else closeListener!();
    await vi.advanceTimersByTimeAsync(0);
    const attempts = writeLine.mock.calls.length;
    expect(h.responder.stop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3500);
    expect(settled).toBe(false);
    expect(writeLine).toHaveBeenCalledTimes(attempts); // No final, warning, or error write retries.
    expect(h.events()).not.toContainEqual(expect.objectContaining({ event: 'cleanup_confirmed' }));
    expect(h.lines.join()).not.toContain('/private/original-output-exception');
    expect(process.stdout.listeners('error')).toContain(errorListener);
    expect(process.stdout.listeners('close')).toContain(closeListener);
    expect(process.listeners('SIGHUP').length).toBe(oldHup.length + 1);
    stopped.resolve(); expect(await task).toBe(1);
    expect(process.stdout.listeners('error')).toEqual(oldErrors);
    expect(process.stdout.listeners('close')).toEqual(oldClose);
    expect(process.listeners('SIGHUP')).toEqual(oldHup);
  });

  it.each(['starting', 'ready', 'response'])('a synchronous %s output failure cannot launch more work or return success', async (event) => {
    const f = await fixture(); const h = harness();
    const enteredStop = deferred<void>(); const stopped = deferred<void>();
    h.responder.stop.mockImplementation(() => { enteredStop.resolve(); return stopped.promise; });
    const writeLine = vi.fn((line: string) => {
      if (line.includes(`\"event\":\"${event}\"`)) throw new Error('secret original output exception');
      h.writeLine(line);
    });
    let settled = false;
    const task = runDiagnostic({ ...h, writeLine, configPath: f.configPath }).then((code) => { settled = true; return code; });
    await enteredStop.promise;
    expect(settled).toBe(false);
    expect(h.responder.start).toHaveBeenCalledTimes(event === 'starting' ? 0 : 1);
    expect(h.responder.answer).toHaveBeenCalledTimes(event === 'response' ? 1 : 0);
    expect(h.responder.stop).toHaveBeenCalledTimes(1);
    expect(h.events()).not.toContainEqual(expect.objectContaining({ event: 'cleanup_confirmed' }));
    expect(h.lines.join()).not.toContain('secret original output exception');
    const attempts = writeLine.mock.calls.length;
    stopped.resolve(); expect(await task).toBe(1);
    expect(writeLine).toHaveBeenCalledTimes(attempts);
  });

  it.each(['starting', 'answering'])('contains a real asynchronous Writable EPIPE during %s in a fake-only Node fixture', async (when) => {
    const f = await fixture();
    const source = `
      import { Writable } from 'node:stream';
      import { runDiagnostic } from ${JSON.stringify(script)};
      const original = process.stdout;
      const sink = new Writable({ write(_chunk, _encoding, callback) {
        setImmediate(() => callback(Object.assign(new Error('secret EPIPE fixture exception'), {code:'EPIPE'})));
      }});
      Object.defineProperty(process, 'stdout', {value:sink});
      let starts=0, answers=0, stops=0, stopFinished=false;
      const fake = {
        start() { starts++; return ${when === 'starting' ? 'new Promise(() => {})' : 'Promise.resolve()'}; },
        answer() { answers++; return new Promise(() => {}); },
        async stop() { stops++; await new Promise(r=>setTimeout(r,20)); stopFinished=true; }
      };
      const code = await runDiagnostic({configPath:${JSON.stringify(f.configPath)},factory:()=>fake});
      original.write(JSON.stringify({code,starts,answers,stops,stopFinished,errorListeners:sink.listenerCount('error'),closeListeners:sink.listenerCount('close')}));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(JSON.parse(output)).toEqual({ code: 1, starts: 1, answers: when === 'starting' ? 0 : 1, stops: 1, stopFinished: true, errorListeners: 0, closeListeners: 0 });
    expect(output).not.toContain('secret EPIPE fixture exception');
  });

  it('returns failure if output throws before any responder exists', async () => {
    const f = await fixture({ port: 0 }); const h = harness();
    const writeLine = vi.fn(() => { throw new Error('secret unowned output exception'); });
    expect(await runDiagnostic({ ...h, writeLine, configPath: f.configPath })).toBe(1);
    expect(writeLine).toHaveBeenCalledTimes(1);
    expect(h.factory).not.toHaveBeenCalled();
  });

  it('does not report success while a successful answer still has unconfirmed cleanup', async () => {
    const f = await fixture(); const h = harness(); vi.useFakeTimers();
    const enteredStop = deferred<void>(); const stopped = deferred<void>();
    h.responder.stop.mockImplementation(() => { enteredStop.resolve(); return stopped.promise; });
    let settled = false;
    const task = runDiagnostic({ ...h, configPath: f.configPath }).then((code) => { settled = true; return code; });
    await enteredStop.promise; await vi.advanceTimersByTimeAsync(3000);
    expect(settled).toBe(false);
    expect(h.events()).not.toContainEqual(expect.objectContaining({ event: 'cleanup_confirmed' }));
    stopped.resolve(); expect(await task).toBe(0);
  });
});
