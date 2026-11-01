#!/usr/bin/env node
/** Operator-only, one-shot probe. Never import the game composition root. */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { defaultConfigPath, parseConfig } from '../src/app/config.ts';
import { selectLlmProfile } from '../src/app/llmProfiles.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import { isNpcFailureCode } from '../src/npc/failureCodes.ts';
import { parseNpcContent } from '../src/world/npcContent.ts';

const ANSWER_MS = 30_000; // Diagnostic only. Never read from or write to game timeoutMs.
const CLEANUP_WARNING_MS = 3_000;
const RESPONSE_LIMIT = 2048;
const WARNING = 'Cleanup is not confirmed. Runtime is quarantined. Keep this terminal open.';

async function productionFactory(options, deps) {
  const { ollamaDiagnostic } = await import('../src/npc/adapters/localLlm.ts');
  return ollamaDiagnostic(options, deps);
}

/** Exclusive binds detect existing listeners without contacting or stopping them.
 * This is a preflight, not a lock. The worker retains its own port/ownership checks.
 */
async function requireFreePort(port) {
  for (const host of ['0.0.0.0', '::']) {
    await new Promise((yes, no) => {
      const server = createServer((socket) => socket.destroy());
      server.once('error', (error) => {
        if (host === '::' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) yes();
        else no(new Error('port_unavailable'));
      });
      server.listen({ port, host, exclusive: true, ipv6Only: true }, () => server.close((error) => error ? no(error) : yes()));
    });
  }
}

function interruptSubscription(callback) {
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(name, callback);
  return () => {
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(name, callback);
  };
}

function defaultWriteLine(line) { process.stdout.write(`${line}\n`); }

/** Internal fixture seams are not CLI options and never come from player input.
 * Returns an exit status only after cleanup confirmation. A quarantined stop stays pending.
 */
export async function runDiagnostic({
  configPath = defaultConfigPath,
  profilesPath,
  factory = productionFactory,
  writeLine = defaultWriteLine,
  signal,
  onInterrupt = interruptSubscription,
} = {}) {
  const began = performance.now();
  const elapsed = () => Math.max(0, Math.floor(performance.now() - began));
  const emit = (event, fields = {}) => safeWrite(JSON.stringify({ event, ...fields }));
  const controller = new AbortController();
  let outputFailed = false;
  let responder;
  let stopPromise;
  let cleanupConfirmed = false;
  let accepted = false;
  let failure;
  let deadlineTimer;
  let progressTimer;
  let phase = 'starting';
  let answerBegan;
  let lastProgress = -1000;
  let lastShape;
  let abortReject;
  const interrupted = new Promise((_yes, no) => { abortReject = no; });
  // The abort may arrive while config IO runs, before an operation races this promise.
  void interrupted.catch(() => {});

  function outputFailure() {
    if (outputFailed) return;
    // Mark the sink first: cancel/stop/final/warning must never retry the failed output.
    outputFailed = true;
    cancel('output_unavailable');
  }
  function safeWrite(line) {
    if (outputFailed) return;
    try { writeLine(line); } catch { outputFailure(); }
  }
  async function flushOutput() {
    if (writeLine === defaultWriteLine && !outputFailed) {
      try {
        await new Promise((resolve) => process.stdout.write('', (error) => {
          if (error) outputFailure();
          resolve();
        }));
      } catch { outputFailure(); }
    }
    // Writable callbacks can precede their queued error event. Keep the listener for that event.
    // Do not write to a failed sink, including when the original writer threw synchronously.
    await nextTurn();
  }

  function stop() {
    if (!responder) return Promise.resolve();
    if (stopPromise) return stopPromise;
    // Keep Node alive even if a faulty adapter loses its own timers during quarantine.
    const keepAlive = setInterval(() => {}, 1000);
    const warning = setTimeout(() => safeWrite(WARNING), CLEANUP_WARNING_MS);
    stopPromise = Promise.resolve().then(() => responder.stop()).then(() => {
      cleanupConfirmed = true;
      clearTimeout(warning); clearInterval(keepAlive);
    }, async () => {
      // A rejected stop is not proof of physical cleanup. Do not exit or release ownership.
      await new Promise(() => {});
    });
    return stopPromise;
  }
  function cancel(reason = 'aborted') {
    if (!controller.signal.aborted) {
      failure = reason;
      controller.abort();
      abortReject(new Error('interrupted'));
    }
    // Repeated Ctrl+C only joins the same owned stop; never signals an arbitrary process.
    void stop();
  }
  const cancelSignal = () => cancel();
  const unsubscribe = onInterrupt(cancelSignal);
  // EPIPE and a closed terminal are cancellation, not uncaught Node errors.
  process.stdout.on('error', outputFailure);
  process.stdout.on('close', outputFailure);
  if (process.stdout.destroyed || !process.stdout.writable) outputFailure();
  signal?.addEventListener('abort', cancelSignal, { once: true });
  if (signal?.aborted) cancel();

  function snapshot() {
    const result = { stage: phase, elapsedMs: elapsed() };
    try {
      const value = responder?.diagnostics?.();
      if (!value || !['preparing', 'prefill', 'decoding', 'complete'].includes(value.stage)) return result;
      result.stage = value.stage;
      for (const [key, max] of [['elapsedMs', 120000], ['promptTokens', 1792], ['firstTokenMs', 120000], ['outputChunks', 4096]]) {
        if (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= max) result[key] = value[key];
      }
      if (result.firstTokenMs !== undefined && answerBegan !== undefined) result.firstTextElapsedMs = answerBegan + result.firstTokenMs;
    } catch { /* Optional hooks never expose arbitrary exceptions. */ }
    return result;
  }
  function progress() {
    const value = snapshot();
    const shape = JSON.stringify({ ...value, elapsedMs: undefined });
    if (shape !== lastShape || elapsed() - lastProgress >= 1000) {
      lastShape = shape; lastProgress = elapsed(); emit('progress', value);
    }
  }
  function lastFailure() {
    try { const value = responder?.lastFailure?.(); return isNpcFailureCode(value) ? value : 'unavailable'; }
    catch { return 'unavailable'; }
  }
  try {
    let config;
    try {
      config = parseConfig(JSON.parse(await readFile(configPath, 'utf8')), configPath);
      const selected = await selectLlmProfile(config, profilesPath === undefined ? {} : { profilesPath });
      config = selected.config;
      if (selected.profile) emit('selection', { backend: selected.profile.backend, model: selected.profile.model, timeoutMs: config.npc.timeoutMs });
    } catch { failure = 'config_invalid'; throw new Error('refused'); }
    if (config.npc.adapter !== 'ollama') { failure = 'adapter_required'; throw new Error('refused'); }
    const nativePort = config.npc.options.port ?? 11501;
    if (!Number.isSafeInteger(nativePort) || nativePort < 1024 || nativePort > 65535) { failure = 'config_invalid'; throw new Error('refused'); }
    let profile;
    try {
      const content = parseNpcContent(JSON.parse(await readFile(join(config.contentDir, 'npcs.json'), 'utf8')));
      const found = content.find((npc) => npc.id === 'fabric-seller');
      if (!found) throw new Error('missing');
      const { id, name, topic, persona, greeting } = found;
      profile = { id, name, topic, persona, greeting };
    } catch { failure = 'content_invalid'; throw new Error('refused'); }
    if (controller.signal.aborted) throw new Error('interrupted');
    try { await requireFreePort(config.port); }
    catch { failure = 'game_port_unavailable'; throw new Error('refused'); }
    try { await requireFreePort(nativePort); }
    catch { failure = 'native_port_unavailable'; throw new Error('refused'); }
    if (controller.signal.aborted) throw new Error('interrupted');
    // The only authorized real probe is on the operator's Intel Mac. Fixtures use a fake factory.
    if (factory === productionFactory && (process.platform !== 'darwin' || process.arch !== 'x64')) {
      failure = 'unsupported_platform'; throw new Error('refused');
    }
    try { responder = await factory(config.npc.options, { clock: systemClock, scheduler: systemScheduler }); }
    catch { failure = 'config_invalid'; throw new Error('refused'); }
    if (controller.signal.aborted) throw new Error('interrupted');
    safeWrite('Diagnostic does not start the game or browser. This result does not qualify game latency.');
    emit('starting', { elapsedMs: elapsed(), answerCeilingMs: ANSWER_MS });
    progress();
    if (controller.signal.aborted) throw new Error('interrupted');
    progressTimer = setInterval(progress, 100);
    await Promise.race([responder.start(), interrupted]);
    if (controller.signal.aborted) throw new Error('interrupted');
    phase = 'ready'; emit('ready', { elapsedMs: elapsed() });
    if (controller.signal.aborted) throw new Error('interrupted');
    answerBegan = elapsed(); phase = 'preparing';
    const deadlineAt = systemClock.now() + ANSWER_MS;
    deadlineTimer = setTimeout(() => cancel('timeout'), ANSWER_MS);
    const answer = await Promise.race([responder.answer({
      requestKey: 'operator-diagnostic', playerId: 'operator-diagnostic', playerName: 'Гость',
      npc: profile, question: 'Привет!', history: [], locale: 'ru', deadlineAt,
    }, controller.signal), interrupted]);
    if (controller.signal.aborted || systemClock.now() >= deadlineAt) { failure ??= 'timeout'; throw new Error('expired'); }
    if (!answer || typeof answer.text !== 'string' || !answer.text.trim() || Buffer.byteLength(answer.text) > 16384 || /<\s*\/?\s*(?:think|analysis)\b/i.test(answer.text)) {
      failure = 'protocol_error'; throw new Error('invalid');
    }
    accepted = true; phase = 'complete'; progress();
    const text = Array.from(answer.text);
    emit('response', { text: text.slice(0, RESPONSE_LIMIT).join(''), truncated: Number(text.length > RESPONSE_LIMIT) });
  } catch {
    failure ??= lastFailure();
    emit('failure', { code: failure });
  } finally {
    clearTimeout(deadlineTimer); clearInterval(progressTimer);
    if (responder) emit('final', snapshot());
    try {
      await stop();
      if (cleanupConfirmed) emit('cleanup_confirmed', { elapsedMs: elapsed() });
      await flushOutput();
    } finally {
      unsubscribe(); signal?.removeEventListener('abort', cancelSignal);
      process.stdout.off('error', outputFailure);
      process.stdout.off('close', outputFailure);
    }
  }
  return accepted && !failure && !outputFailed && cleanupConfirmed ? 0 : 1;
}

// Importing this file must never launch a runtime, read config, or install signal handlers.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) {
    console.error('Diagnostic accepts no command-line arguments.');
    process.exitCode = 1;
  } else {
    // Never force process.exit(): an uncertain owned runtime must keep its quarantine alive.
    process.exitCode = await runDiagnostic();
  }
}
