import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { localLlm, localLlmForTest, memoryBytesForTest, mlx, ollama, type LocalLlmResponder } from '../src/npc/adapters/localLlm.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import { answerRequest, responderContract } from './responderContract.ts';

type Backend = 'ollama' | 'mlx';
type Runtime = Parameters<typeof localLlmForTest>[3];
const deps = { clock: systemClock, scheduler: systemScheduler };
const options = (backend: Backend): Record<string, unknown> => ({
  python: process.execPath, runnerVersion: '1.2.3',
  ...(backend === 'ollama' ? {
    executable: '/prepared/ollama', modelsDir: '/prepared/models', tokenizerDir: '/prepared/tokenizer',
    tokenizerManifest: '/prepared/tokenizer.json', model: 'qwen3.5:2b-q4_K_M', modelDigest: 'a'.repeat(64),
  } : { modelDir: '/prepared/mlx', modelManifest: '/prepared/model.json' }),
});
interface Event { type: string; pid?: number; options?: Record<string, unknown>; env?: Record<string, string>; question?: string; history?: { question: string; answer: string }[]; args?: string[] }
const fixtures: { responder: LocalLlmResponder; dir: string }[] = [];
const releaseCleanup: (() => void)[] = [];
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, timeout = 2500): Promise<void> {
  const deadline = performance.now() + timeout;
  while (!check()) { if (performance.now() >= deadline) throw new Error('Fixture condition timed out'); await wait(10); }
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

/** Real Node processes and pipes only. No Python packages, runner, model or external network. */
function fixture(backend: Backend = 'ollama', startup = 'normal', runtime: Partial<Runtime> = {}, overrides: Record<string, unknown> = {}, fixtureDeps = deps) {
  const dir = mkdtempSync(join(tmpdir(), 'npc-supervisor-'));
  const workerPath = join(dir, 'fixture.cjs'); const log = join(dir, 'events.jsonl');
  writeFileSync(log, '');
  writeFileSync(workerPath, `
const fs = require('node:fs');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const log = (event) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(event) + '\\n');
const send = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
const startup = ${JSON.stringify(startup)};
let descendant;
if (startup === 'stubborn') process.on('SIGTERM', () => log({type:'term'}));
log({type:'spawn',pid:process.pid,args:process.argv.slice(2)});
readline.createInterface({input:process.stdin}).on('line', (line) => {
  const event = JSON.parse(line);
  if (event.op === 'start') {
    log({type:'start',options:event.options,env:process.env});
    if (startup === 'silent' || startup === 'stubborn') return;
    if (startup === 'startup-error') return send({type:'error',code:'model_unavailable',message:'secret local model path'});
    if (startup === 'malformed') return process.stdout.write('not json\\n');
    if (startup === 'safe-diagnostic') return send({type:'error',code:'model_unavailable',message:'secret prompt, path and body',diagnostic:'ollama_model_integrity'});
    if (startup === 'unsafe-diagnostic') return send({type:'error',code:'model_unavailable',message:'secret prompt, path and body',diagnostic:'secret prompt /Users/private/path'});
    if (startup === 'descendant') {
      descendant = spawn(process.execPath, ['-e','setInterval(() => {}, 1000)'], {stdio:'ignore'});
      log({type:'descendant',pid:descendant.pid});
    }
    send({type:'ready'});
    if (startup === 'ready-partial') setTimeout(() => process.stdout.write('{'), 20);
  } else if (event.op === 'answer') {
    const q = event.request.question;
    log({type:'answer',question:q,history:event.request.history});
    const prefill = {type:'progress',stage:'prefill',promptTokens:123};
    const decoding = {type:'progress',stage:'decoding',outputChunks:1};
    const complete = {type:'progress',stage:'complete',outputChunks:1};
    const answer = {type:'answer',text:'Ответ'};
    const batch = (...items) => process.stdout.write(items.map(JSON.stringify).join('\\n')+'\\n');
    if (q === 'progress-live') {
      const gate = (name, action) => {
        const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(dir)}+'/'+name)) { clearInterval(timer); action(); } }, 5);
      };
      send(prefill);
      gate('decode', () => { send(decoding); gate('complete', () => batch(complete, answer)); });
      return;
    }
    if (q === 'progress-timeout' || q === 'progress-terminal-later') {
      send(prefill);
      setTimeout(() => send(decoding), 40);
      if (q === 'progress-terminal-later') setTimeout(() => send(complete), 80);
      return;
    }
    if (q === 'late-partial') { send(answer); setTimeout(() => process.stdout.write('{'), 50); return; }
    if (q === 'progress-batch') return batch(prefill, decoding, complete, answer);
    if (q === 'progress-batch-bad') return process.stdout.write([prefill,decoding,complete,answer].map(JSON.stringify).join('\\n')+'\\n{bad}\\n');
    if (q === 'progress-batch-extra') return batch(prefill, decoding, complete, answer, answer);
    if (q === 'progress-batch-prefix') return process.stdout.write([prefill,decoding,complete,answer].map(JSON.stringify).join('\\n')+'\\n{');
    if (q === 'progress-extra') return send({...prefill,secret:'prompt /private/path'});
    if (q === 'progress-prompt-limit') return send({...prefill,promptTokens:1793});
    if (q === 'progress-fraction') return send({...prefill,promptTokens:0.5});
    if (q === 'progress-infinite') return process.stdout.write('{"type":"progress","stage":"prefill","promptTokens":1e999}\\n');
    if (q === 'progress-long-literal') return process.stdout.write('{"type":"progress","stage":"prefill","promptTokens":0.'+'0'.repeat(600)+'}\\n');
    if (q === 'progress-order') return send(decoding);
    if (q === 'progress-skip-first') return batch(prefill, {...decoding,outputChunks:2});
    if (q === 'progress-no-first') return batch(prefill, complete, answer);
    if (q === 'progress-repeat') return batch(prefill, prefill);
    if (q === 'progress-regress') return batch(prefill, decoding, {...decoding,outputChunks:0});
    if (q === 'progress-chunk-limit') return batch(prefill, {...decoding,outputChunks:4097});
    if (q === 'progress-too-many') return batch(prefill, ...Array.from({length:12},(_,i)=>({...decoding,outputChunks:i+1})));
    if (q === 'progress-early-answer') return batch(prefill, decoding, answer);
    if (q === 'progress-after-complete') return batch(prefill, decoding, complete, decoding);
    if (q === 'stall') return;
    if (q === 'exit') return process.exit(7);
    if (q === 'malformed') return process.stdout.write('{bad}\\n');
    if (q === 'utf8') return process.stdout.write(Buffer.from([0xc3,0x28,10]));
    if (q === 'oversized') return process.stdout.write('x'.repeat(65537));
    if (q === 'oversized-text') return send({type:'answer',text:'я'.repeat(8193)});
    if (q === 'stderr') return process.stderr.write('secret'.repeat(12000));
    if (q === 'double') return process.stdout.write(JSON.stringify({type:'answer',text:'valid prefix'})+'\\n{bad}\\n');
    if (q === 'empty') return send({type:'answer',text:'  '});
    if (q === 'thinking') return send({type:'answer',text:'<think>private reasoning</think>answer'});
    if (q === 'error') return send({type:'error',code:'unknown_secret_code',message:'secret prompt and local path'});
    if (q === 'known-error') return send({type:'error',code:'model_unavailable',message:'secret prompt and local path'});
    if (q === 'error-limit') return send({type:'error',code:'model_unavailable',message:'x'.repeat(1025)});
    if (q === 'partial') return process.stdout.write('{"type":"answer","text":"prefix"}');
    setTimeout(() => send({type:'answer',text:'Ответ: '+q}), 60);
  } else if (event.op === 'stop') {
    log({type:'stop'});
    if (descendant) { descendant.once('exit', () => process.exit(0)); descendant.kill('SIGTERM'); }
    else if (startup !== 'stubborn') process.exit(0);
  }
});
`);
  let ownedGroup: number | undefined;
  const responder = localLlmForTest(backend, { ...options(backend), ...overrides }, fixtureDeps, {
    workerPath, workerPrefix: [], platform: 'darwin', arch: 'arm64', ...runtime,
    memoryBytes(group) {
      // The OS can stop a startup worker before its JS writes the fixture log.
      // Observe its actual owned PID at the existing measurement boundary.
      ownedGroup = group;
      return (runtime.memoryBytes ?? memoryBytesForTest)(group);
    },
  });
  fixtures.push({ responder, dir });
  const events = (): Event[] => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Event);
  const pid = () => {
    if (ownedGroup === undefined) throw new Error('Fixture worker has not spawned');
    return ownedGroup;
  };
  return { responder, events, pid, releaseProgress: (name: 'decode' | 'complete') => writeFileSync(join(dir, name), '') };
}
afterEach(async () => {
  for (const release of releaseCleanup.splice(0)) release();
  await Promise.all(fixtures.map(({ responder }) => responder.stop()));
  for (const { dir } of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

for (const backend of ['ollama', 'mlx'] as const) {
  describe(`${backend} strict operator options`, () => {
    it('validates required paths, version, unknown keys and numeric limits before spawn', () => {
      const valid = options(backend);
      expect(() => localLlm(backend, valid, deps)).not.toThrow();
      const paths = backend === 'ollama' ? ['python', 'executable', 'modelsDir', 'tokenizerDir', 'tokenizerManifest'] : ['python', 'modelDir', 'modelManifest'];
      for (const key of paths) for (const value of [undefined, '', 'relative', '/bad\0path', 3]) {
        expect(() => localLlm(backend, { ...valid, [key]: value }, deps), `${key}: ${String(value)}`).toThrow();
      }
      for (const invalid of [null, [], 3]) expect(() => localLlm(backend, invalid as unknown as Record<string, unknown>, deps)).toThrow();
      for (const runnerVersion of ['latest', '1', 'v1.2.3', '1.2.3.dev1', '', undefined]) expect(() => localLlm(backend, { ...valid, runnerVersion }, deps)).toThrow();
      for (const extra of ['workerPath', 'workerPrefix', 'runtime', 'endpoint', 'backend', 'modelPath', 'sampleMemory', 'platform']) expect(() => localLlm(backend, { ...valid, [extra]: true }, deps)).toThrow('Unknown');
      for (const threads of [0, 65, 1.5, '2', null, undefined]) expect(() => localLlm(backend, { ...valid, threads }, deps)).toThrow();
      for (const startupTimeoutMs of [0, 120001, 0.5, '1000', null, undefined]) expect(() => localLlm(backend, { ...valid, startupTimeoutMs }, deps)).toThrow();
      expect(() => localLlm(backend, { ...valid, threads: 64, startupTimeoutMs: 120000 }, deps)).not.toThrow();
    });
    it('defers platform refusal until start and leaves safe diagnostics', async () => {
      for (const [platform, arch] of backend === 'mlx' ? [['linux', 'arm64'], ['darwin', 'x64'], ['win32', 'arm64']] : [['win32', 'x64'], ['freebsd', 'x64'], ['linux', 'ia32']]) {
        const { responder, events } = fixture(backend, 'normal', { platform, arch });
        expect(responder.status()).toBe('unavailable');
        await expect(responder.start()).rejects.toThrow('unsupported_platform');
        expect(responder.lastFailure()).toBe('unsupported_platform');
        expect(events()).toEqual([]); await responder.stop();
      }
    });
  });
}
it('validates literal Ollama model, digest, port and explicit CPU/GPU setting', () => {
  const valid = options('ollama');
  for (const model of ['other', 'qwen3.5:2b', 'qwen3.5:2b-q4_K_M-cloud', undefined]) expect(() => ollama({ ...valid, model }, deps)).toThrow();
  for (const modelDigest of ['latest', 'a'.repeat(63), 'g'.repeat(64), undefined]) expect(() => ollama({ ...valid, modelDigest }, deps)).toThrow();
  expect(() => ollama({ ...valid, modelDigest: `sha256:${'A'.repeat(64)}` }, deps)).not.toThrow();
  for (const port of [1023, 65536, 11501.1, '11501', null]) expect(() => ollama({ ...valid, port }, deps)).toThrow();
  for (const numGpu of [-1, 129, 0.5, '0', null]) expect(() => ollama({ ...valid, numGpu }, deps)).toThrow();
  expect(() => ollama({ ...valid, port: 65535, numGpu: 128 }, deps)).not.toThrow();
  expect(() => mlx({ ...options('mlx'), numGpu: 0 }, deps)).toThrow('Unknown');
});

describe.skipIf(process.platform === 'win32')('real Node fixture supervision (not model qualification)', () => {
  responderContract('ollama supervisor / Node fixture', () => fixture('ollama').responder, { realTimers: true });
  responderContract('mlx supervisor / Node fixture', () => fixture('mlx').responder, { realTimers: true });

  it('starts once concurrently, retains a warm worker, stops idempotently and explicitly restarts', async () => {
    const { responder, events, pid } = fixture();
    await Promise.all([responder.start(), responder.start(), responder.start()]);
    expect(events().filter((event) => event.type === 'spawn')).toHaveLength(1);
    const first = pid();
    for (const question of ['один', 'два']) expect(await responder.answer({ ...answerRequest(), question }, new AbortController().signal)).toEqual({ text: `Ответ: ${question}` });
    expect(responder.status()).toBe('ready');
    const stop = responder.stop(); expect(responder.status()).toBe('unavailable');
    await Promise.all([stop, responder.stop()]); expect(alive(first)).toBe(false);
    await Promise.all([responder.start(), responder.start()]);
    expect(events().filter((event) => event.type === 'spawn')).toHaveLength(2);
    expect(responder.lastFailure()).toBeUndefined();
    const second = events().filter((event) => event.type === 'spawn')[1]!.pid!;
    await responder.stop(); expect(alive(second)).toBe(false);
  });
  it('exposes only bounded monotonic current-answer diagnostics and resets on next answer/restart', async () => {
    let mono = 0;
    const { responder, releaseProgress } = fixture('ollama', 'normal', { monotonicNow: () => mono });
    await responder.start(); expect(responder.diagnostics?.()).toBeUndefined();
    mono = 100;
    const pending = responder.answer({ ...answerRequest(), question: 'progress-live' }, new AbortController().signal);
    expect(responder.diagnostics?.()).toEqual({ stage: 'preparing', elapsedMs: 0 });
    mono = 110;
    await until(() => responder.diagnostics?.()?.stage === 'prefill');
    expect(responder.diagnostics?.()).toEqual({ stage: 'prefill', elapsedMs: 10, promptTokens: 123 });
    mono = 125; releaseProgress('decode');
    await until(() => responder.diagnostics?.()?.stage === 'decoding');
    expect(responder.diagnostics?.()).toEqual({ stage: 'decoding', elapsedMs: 25, promptTokens: 123, firstTokenMs: 25, outputChunks: 1 });
    // Returned values are fresh copies, not an externally mutable backing object.
    Object.assign(responder.diagnostics?.() ?? {}, { promptTokens: 999, secret: 'private' });
    mono = 140; releaseProgress('complete');
    await expect(pending).resolves.toEqual({ text: 'Ответ' });
    const completed = responder.diagnostics?.();
    expect(completed).toEqual({ stage: 'complete', elapsedMs: 40, promptTokens: 123, firstTokenMs: 25, outputChunks: 1 });
    mono = 500; expect(responder.diagnostics?.()).toEqual(completed);
    const controller = new AbortController();
    const next = responder.answer({ ...answerRequest(), question: 'stall' }, controller.signal);
    const rejected = expect(next).rejects.toThrow('aborted');
    expect(responder.diagnostics?.()).toEqual({ stage: 'preparing', elapsedMs: 0 });
    mono = 200000; expect(responder.diagnostics?.()?.elapsedMs).toBe(120000);
    controller.abort(); mono = 300000;
    await rejected; expect(responder.diagnostics?.()).toEqual({ stage: 'preparing', elapsedMs: 120000 });
    await responder.start(); expect(responder.diagnostics?.()).toBeUndefined();
  });
  it('accepts coalesced private progress plus one terminal answer, but MLX supplies no fabricated timing', async () => {
    const { responder } = fixture(); await responder.start();
    await expect(responder.answer({ ...answerRequest(), question: 'progress-batch' }, new AbortController().signal)).resolves.toEqual({ text: 'Ответ' });
    expect(responder.diagnostics?.()).toMatchObject({ stage: 'complete', promptTokens: 123, outputChunks: 1 });
    const { responder: other } = fixture('mlx'); await other.start();
    await other.answer(answerRequest(), new AbortController().signal); expect(other.diagnostics?.()).toBeUndefined();
    await expect(other.answer({ ...answerRequest(), question: 'progress-batch' }, new AbortController().signal)).rejects.toThrow('protocol_error');
  });
  it.each(['progress-timeout', 'progress-terminal-later'])('keeps %s diagnostics after timeout without claiming accepted completion', async (question) => {
    const { responder } = fixture(); await responder.start();
    const began = performance.now();
    await expect(responder.answer({ ...answerRequest(), question, deadlineAt: Date.now() + 200 }, new AbortController().signal)).rejects.toThrow('timeout');
    const sample = responder.diagnostics?.();
    expect(sample).toMatchObject({ stage: 'decoding', promptTokens: 123, outputChunks: 1 });
    expect(sample?.firstTokenMs).toBeLessThanOrEqual(sample!.elapsedMs);
    expect(performance.now() - began).toBeLessThan(1500);
    await wait(20); expect(responder.diagnostics?.()).toEqual(sample);
  });
  it.each([
    'progress-batch-bad', 'progress-batch-extra', 'progress-batch-prefix', 'progress-extra', 'progress-prompt-limit',
    'progress-fraction', 'progress-infinite', 'progress-long-literal', 'progress-order', 'progress-skip-first', 'progress-no-first', 'progress-repeat', 'progress-regress', 'progress-chunk-limit',
    'progress-too-many', 'progress-early-answer', 'progress-after-complete',
  ])('rejects invalid bounded progress %s without accepting a terminal prefix', async (question) => {
    const { responder } = fixture(); await responder.start();
    await expect(responder.answer({ ...answerRequest(), question }, new AbortController().signal)).rejects.toThrow(/^protocol_error$/);
    expect(responder.diagnostics?.()).toMatchObject({ stage: 'preparing' });
    expect(JSON.stringify(responder.diagnostics?.())).not.toMatch(/private|promptTokens|secret/);
  });
  it('rejects partial bytes after ready even while the initial memory sample still blocks admission', async () => {
    const { responder, events } = fixture('ollama', 'ready-partial', { memoryBytes: async () => { await wait(300); return 100; } });
    await expect(responder.start()).rejects.toThrow('protocol_error');
    expect(responder.status()).toBe('unavailable');
    await expect(responder.answer(answerRequest(), new AbortController().signal)).rejects.toThrow('unavailable');
    expect(events().some((item) => item.type === 'answer')).toBe(false);
  });
  it('rejects later idle partial bytes before they can contaminate another answer', async () => {
    const { responder, events } = fixture(); await responder.start();
    await expect(responder.answer({ ...answerRequest(), question: 'late-partial' }, new AbortController().signal)).resolves.toEqual({ text: 'Ответ' });
    // A later pipe event cannot retract that accepted answer. It must close this worker.
    await until(() => responder.status() === 'unavailable');
    expect(responder.lastFailure()).toBe('protocol_error');
    await expect(responder.answer(answerRequest(), new AbortController().signal)).rejects.toThrow('unavailable');
    expect(events().filter((item) => item.type === 'answer')).toHaveLength(1);
  });
  it('sends strict defaults and offline environment through private IPC without mutating caller options', async () => {
    for (const backend of ['ollama', 'mlx'] as const) {
      const { responder, events } = fixture(backend); await responder.start();
      const event = events().find((item) => item.type === 'start')!;
      expect(event.options).toMatchObject({ threads: 2, startupTimeoutMs: 120000 });
      if (backend === 'ollama') expect(event.options).toMatchObject({ port: 11501, numGpu: 0 });
      expect(event.env).toMatchObject({ PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: '', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', OLLAMA_NO_CLOUD: '1', OMP_NUM_THREADS: '2' });
      expect(events().find((item) => item.type === 'spawn')!.args).toEqual([]);
      await responder.stop();
    }
  });
  it('uses fixed production worker location and Python flags; missing Python does not escape diagnostics', async () => {
    // Node rejects -u/-B rather than running a model. This must fail safely, never install anything.
    const responder = ollama(options('ollama'), deps);
    try { await expect(responder.start()).rejects.toThrow('unavailable'); expect(responder.status()).toBe('unavailable'); }
    finally { await responder.stop(); }
    const { responder: missing, events } = fixture('ollama', 'normal', {}, { python: '/not-installed/python' });
    await expect(missing.start()).rejects.toThrow('unavailable');
    expect(events()).toEqual([]); expect(missing.status()).toBe('unavailable');
  });
  it('has one active answer and no queue; abort physically stops it before settlement', async () => {
    const { responder, events, pid } = fixture(); await responder.start();
    const controller = new AbortController();
    const pending = responder.answer({ ...answerRequest(), question: 'stall' }, controller.signal);
    const rejected = expect(pending).rejects.toThrow('aborted');
    await until(() => events().some((event) => event.type === 'answer'));
    await expect(responder.answer(answerRequest(), new AbortController().signal)).rejects.toThrow('busy');
    controller.abort(); expect(responder.status()).toBe('unavailable');
    await rejected; expect(alive(pid())).toBe(false);
    await expect(responder.answer(answerRequest(), new AbortController().signal)).rejects.toThrow('unavailable');
    expect(events().filter((event) => event.type === 'answer')).toHaveLength(1);
    await responder.start();
    expect(await responder.answer(answerRequest(), new AbortController().signal)).toEqual({ text: 'Ответ: Вопрос' });
  });
  it('stops startup, including a worker that ignores stop and SIGTERM', async () => {
    const { responder, events, pid } = fixture('ollama', 'stubborn', {}, { startupTimeoutMs: 1000 });
    const start = responder.start(); const rejected = expect(start).rejects.toThrow('stopped');
    await until(() => events().some((event) => event.type === 'start'));
    const began = performance.now(); await responder.stop(); await rejected;
    expect(performance.now() - began).toBeLessThan(2000); expect(alive(pid())).toBe(false);
    expect(events().some((event) => event.type === 'term')).toBe(true);
  });
  it('enforces startup timeout and safe startup errors, then confirms cleanup', async () => {
    for (const [startup, reason] of [['silent', 'startup_timeout'], ['startup-error', 'model_unavailable'], ['malformed', 'protocol_error']]) {
      const { responder, pid } = fixture('ollama', startup, {}, { startupTimeoutMs: startup === 'silent' ? 250 : 2000 });
      await expect(responder.start()).rejects.toThrow(reason);
      expect(responder.status()).toBe('unavailable'); expect(responder.lastFailure()).toBe(reason);
      await responder.stop(); expect(alive(pid())).toBe(false);
    }
  });
  it('keeps only allowlisted startup diagnostics, never a worker message or an arbitrary diagnostic', async () => {
    for (const [startup, reason] of [['safe-diagnostic', 'ollama_model_integrity'], ['unsafe-diagnostic', 'model_unavailable']]) {
      const { responder } = fixture('ollama', startup);
      await expect(responder.start()).rejects.toThrow(reason);
      expect(responder.lastFailure()).toBe(reason);
      expect(responder.status()).toBe('unavailable');
      await responder.stop();
    }
  });
  it('enforces wall deadline even without timer delivery and the 9 s monotonic ceiling after a clock rollback', async () => {
    for (const mode of ['wall', 'monotonic']) {
      let wall = Date.now(); let mono = 0;
      const { responder, events, pid } = fixture('ollama', 'normal', { monotonicNow: () => mono }, {}, { ...deps, clock: { now: () => wall } });
      await responder.start();
      const request = { ...answerRequest(), deadlineAt: wall + (mode === 'wall' ? 5000 : 60000) };
      const pending = responder.answer(request, new AbortController().signal);
      const rejected = expect(pending).rejects.toThrow('timeout');
      await until(() => events().some((event) => event.type === 'answer'));
      if (mode === 'wall') wall += 6000; else { wall -= 60000; mono = 9001; }
      // Cleanup needs a moving monotonic clock only for escalation; this worker honors stop.
      await rejected; expect(alive(pid())).toBe(false); expect(responder.status()).toBe('unavailable');
      await responder.stop();
    }
  });
  it('times out partial/no output without accepting a truncated answer', async () => {
    for (const question of ['partial', 'stall']) {
      const { responder, pid } = fixture(); await responder.start();
      await expect(responder.answer({ ...answerRequest(), question, deadlineAt: Date.now() + 120 }, new AbortController().signal)).rejects.toThrow('timeout');
      expect(alive(pid())).toBe(false);
    }
  });
  it.each([
    ['malformed', 'protocol_error'], ['utf8', 'protocol_error'], ['double', 'protocol_error'], ['empty', 'protocol_error'], ['thinking', 'protocol_error'],
    ['oversized', 'output_limit'], ['oversized-text', 'output_limit'], ['stderr', 'output_limit'],
    ['error', 'unavailable'], ['known-error', 'model_unavailable'], ['error-limit', 'protocol_error'], ['exit', 'unavailable'],
  ])('rejects %s without partial success or secret diagnostic text', async (question, reason) => {
    const { responder, pid } = fixture(); await responder.start();
    await expect(responder.answer({ ...answerRequest(), question }, new AbortController().signal)).rejects.toThrow(new RegExp(`^${reason}$`));
    expect(responder.lastFailure()).toBe(reason); expect(responder.status()).toBe('unavailable'); expect(alive(pid())).toBe(false);
  });
  it('bounds question bytes and serialized request bytes before writing', async () => {
    for (const request of [
      { ...answerRequest(), question: 'я'.repeat(2049) },
      { ...answerRequest(), npc: { ...answerRequest().npc, persona: 'x'.repeat(65536) } },
    ]) {
      const { responder, events, pid } = fixture(); await responder.start();
      await expect(responder.answer(request, new AbortController().signal)).rejects.toThrow('input_too_long');
      expect(events().some((event) => event.type === 'answer')).toBe(false); expect(alive(pid())).toBe(false);
    }
  });
  it('trims complete oldest Unicode history pairs within 64 KiB and keeps the trusted core', async () => {
    const { responder, events } = fixture(); await responder.start();
    const history = Array.from({ length: 6 }, (_, index) => ({ question: `${index}${'я'.repeat(3999)}`, answer: '🙂'.repeat(2000) }));
    const request = { ...answerRequest(), history };
    await expect(responder.answer(request, new AbortController().signal)).resolves.toEqual({ text: 'Ответ: Вопрос' });
    const sent = events().find((event) => event.type === 'answer')!;
    expect(sent.history).toEqual(history.slice(2)); expect(history).toHaveLength(6);
    expect(sent.question).toBe(request.question);
    expect(Buffer.byteLength(JSON.stringify({ op: 'answer', request: { ...request, history: sent.history } }) + '\n')).toBeLessThanOrEqual(65536);
  });
  it.each([null, {}, [{ question: 1, answer: 'x' }], [{ question: 'x' }]])('rejects malformed history %j defensively', async (history) => {
    const { responder, pid } = fixture(); await responder.start();
    await expect(responder.answer({ ...answerRequest(), history } as unknown as ReturnType<typeof answerRequest>, new AbortController().signal)).rejects.toThrow('input_too_long');
    expect(alive(pid())).toBe(false);
  });
  it('fails closed on startup memory excess, invalid measurements or measurement errors', async () => {
    for (const { memoryBytes, reason } of [
      { memoryBytes: async () => 3_500_000_000, reason: 'resource_limit' },
      { memoryBytes: async () => 0, reason: 'memory_sample_invalid' },
      { memoryBytes: async () => NaN, reason: 'memory_sample_invalid' },
      { memoryBytes: async () => { throw new Error('secret ps diagnostic'); }, reason: 'memory_unavailable' },
    ]) {
      const { responder, pid } = fixture('ollama', 'normal', { memoryBytes });
      await expect(responder.start()).rejects.toThrow(new RegExp(`^${reason}$`));
      expect(responder.lastFailure()).toBe(reason);
      expect(responder.status()).toBe('unavailable'); await responder.stop(); expect(alive(pid())).toBe(false);
    }
  });
  it.each([
    'memory_sample_ps_timeout', 'memory_sample_ps_failed', 'memory_sample_ps_limit',
    'memory_sample_parse', 'memory_sample_missing', 'memory_sample_invalid', 'memory_sample_deadline',
  ])('preserves the fixed memory diagnostic %s and still fails closed', async (reason) => {
    const { responder, pid } = fixture('ollama', 'normal', { memoryBytes: async () => { throw new Error(reason); } });
    await expect(responder.start()).rejects.toThrow(new RegExp(`^${reason}$`));
    expect(responder.lastFailure()).toBe(reason); expect(responder.status()).toBe('unavailable');
    await responder.stop(); expect(alive(pid())).toBe(false);
  });
  it.each(['model_unavailable', 'memory_sample_unknown'])('does not mistake an unrelated or unknown exception %s for a memory diagnostic', async (message) => {
    const { responder } = fixture('ollama', 'normal', { memoryBytes: async () => { throw new Error(message); } });
    await expect(responder.start()).rejects.toThrow(/^memory_unavailable$/);
    expect(responder.lastFailure()).toBe('memory_unavailable'); await responder.stop();
  });
  it.each(['private rejection /Users/private/path', 'memory_sample_ps_timeout'])('does not expose or promote a non-Error rejection (%s)', async (rejection) => {
    const { responder } = fixture('ollama', 'normal', { memoryBytes: () => Promise.reject(rejection) });
    await expect(responder.start()).rejects.toThrow(/^memory_unavailable$/);
    expect(responder.lastFailure()).toBe('memory_unavailable'); await responder.stop();
  });
  it('reports a memory-sampling failure during a live answer without accepting a late result', async () => {
    let failMeasurement = false;
    const { responder, pid } = fixture('ollama', 'normal', { memoryBytes: async () => {
      if (failMeasurement) throw new Error('memory_sample_ps_timeout'); return 100;
    } });
    await responder.start();
    const pending = expect(responder.answer({ ...answerRequest(), question: 'stall' }, new AbortController().signal)).rejects.toThrow(/^memory_sample_ps_timeout$/);
    failMeasurement = true;
    await pending; expect(responder.status()).toBe('unavailable'); expect(responder.lastFailure()).toBe('memory_sample_ps_timeout');
    await responder.stop(); expect(alive(pid())).toBe(false);
  });
  it('watches idle and active runtime memory and permits only explicit recovery after cleanup', async () => {
    for (const active of [false, true]) {
      let bytes = 100;
      const { responder, pid } = fixture('ollama', 'normal', { memoryBytes: async () => bytes }); await responder.start();
      let rejected: Promise<void> | undefined;
      if (active) rejected = expect(responder.answer({ ...answerRequest(), question: 'stall' }, new AbortController().signal)).rejects.toThrow('resource_limit');
      bytes = 3_500_000_000;
      await until(() => responder.status() === 'unavailable');
      await responder.stop(); await rejected;
      expect(responder.lastFailure()).toBe('resource_limit'); expect(alive(pid())).toBe(false);
      bytes = 100; await responder.start(); expect(responder.status()).toBe('ready'); await responder.stop();
    }
  });
  it('bounds hung startup memory sampling and refuses ready before the initial sample', async () => {
    const { responder, pid } = fixture('ollama', 'normal', { memoryBytes: () => new Promise(() => {}) });
    const pending = responder.start(); const rejected = expect(pending).rejects.toThrow('memory_sample_deadline');
    await wait(100); expect(responder.status()).toBe('unavailable');
    await rejected; await responder.stop(); expect(alive(pid())).toBe(false);
  });
  it('quarantines an unconfirmed cleanup without settling the slot or spawning a replacement', async () => {
    let confirm = false; releaseCleanup.push(() => { confirm = true; });
    const { responder, events } = fixture('ollama', 'normal', { groupAlive: async () => !confirm });
    await responder.start(); const controller = new AbortController();
    const pending = responder.answer({ ...answerRequest(), question: 'stall' }, controller.signal);
    let settled = false; const rejected = pending.catch((error: Error) => { settled = true; expect(error.message).toBe('aborted'); });
    controller.abort();
    await expect(responder.start()).rejects.toThrow('unavailable');
    await wait(250); expect(settled).toBe(false); expect(responder.status()).toBe('unavailable');
    expect(events().filter((event) => event.type === 'spawn')).toHaveLength(1);
    confirm = true; await rejected; await responder.start();
    expect(events().filter((event) => event.type === 'spawn')).toHaveLength(2);
    await responder.stop();
  });
  it('rejects startup promptly but retains quarantine and refuses recovery until confirmed cleanup', async () => {
    let confirm = false; releaseCleanup.push(() => { confirm = true; });
    const { responder, events } = fixture('ollama', 'startup-error', { groupAlive: async () => !confirm });
    const began = performance.now(); await expect(responder.start()).rejects.toThrow('model_unavailable');
    expect(performance.now() - began).toBeLessThan(2000);
    expect(responder.status()).toBe('unavailable');
    await expect(responder.start()).rejects.toThrow('unavailable');
    const stopped = responder.stop(); await wait(150);
    expect(events().filter((event) => event.type === 'spawn')).toHaveLength(1);
    confirm = true; await stopped;
  });
  it('does not signal a reused numeric group after the owned leader has exited', async () => {
    let confirm = false; releaseCleanup.push(() => { confirm = true; });
    const { responder, pid } = fixture('ollama', 'normal', { groupAlive: async () => !confirm }); await responder.start();
    const group = pid(); const spy = vi.spyOn(process, 'kill');
    try {
      let settled = false;
      const pending = responder.answer({ ...answerRequest(), question: 'exit' }, new AbortController().signal).catch((error: Error) => { settled = true; expect(error.message).toBe('unavailable'); });
      await until(() => !alive(group));
      // Simulate a new, unrelated group with the same numeric identity in ps.
      await wait(650);
      expect(spy.mock.calls.filter(([target, signal]) => target === -group && signal !== 0)).toEqual([]);
      expect(settled).toBe(false); expect(responder.status()).toBe('unavailable');
      confirm = true; await pending;
    } finally { spy.mockRestore(); }
  });
  it('does not launch a delayed replacement when stop races with recovery during cleanup', async () => {
    let confirm = false; releaseCleanup.push(() => { confirm = true; });
    const { responder, events } = fixture('ollama', 'normal', { groupAlive: async () => !confirm }); await responder.start();
    const controller = new AbortController();
    const pending = expect(responder.answer({ ...answerRequest(), question: 'stall' }, controller.signal)).rejects.toThrow('aborted');
    controller.abort();
    await expect(responder.start()).rejects.toThrow('unavailable');
    const stopped = responder.stop(); confirm = true; await stopped; await pending;
    await wait(50); expect(responder.status()).toBe('unavailable');
    expect(events().filter((event) => event.type === 'spawn')).toHaveLength(1);
  });
  it('kills only the owned group, including a descendant, and leaves an unrelated process alive', async () => {
    const unrelated: ChildProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true });
    try {
      const { responder, events, pid } = fixture('ollama', 'descendant'); await responder.start();
      const descendant = events().find((event) => event.type === 'descendant')!.pid!;
      expect(alive(descendant)).toBe(true);
      await responder.stop(); expect(alive(pid())).toBe(false);
      // This fixture reaps its child before exit, just as the production workers must do.
      let descendantRunning = false;
      try { descendantRunning = !execFileSync('/bin/ps', ['-p', String(descendant), '-o', 'stat='], { encoding: 'utf8' }).trim().startsWith('Z'); } catch { /* Already reaped. */ }
      expect(descendantRunning).toBe(false);
      expect(alive(unrelated.pid!)).toBe(true);
    } finally {
      unrelated.kill('SIGKILL'); await new Promise<void>((resolve) => unrelated.once('exit', () => resolve()));
    }
  });
});
