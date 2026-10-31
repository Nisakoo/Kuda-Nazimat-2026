import type { NpcAnswer, NpcQuestion, NpcQuestions } from '../contracts.ts';
import type { Clock, Scheduler, TimerHandle } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import type { NpcResponder } from './NpcResponder.ts';
import type { DialogueStore } from './ports.ts';

interface Job {
  question: NpcQuestion; deadline: number; controller: AbortController; running: boolean; settled: boolean;
  resolve: (answer: NpcAnswer) => void; timeout?: TimerHandle; stuck?: TimerHandle;
}
export function normalizeAnswer(text: string): string { return text.replace(/\r\n/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '').trim().slice(0, 4000); }
export function createNpcDialogueService(deps: { responder: NpcResponder; dialogue: DialogueStore; clock: Clock; scheduler: Scheduler; logger: Logger }, config: { maxConcurrent: number; maxUnfinished: number; timeoutMs: number }): NpcQuestions & { start(): Promise<void>; stop(): Promise<void>; ready(): boolean } {
  const { responder, dialogue, clock, scheduler, logger } = deps;
  const jobs = new Set<Job>(); const queue: Job[] = [];
  let active = 0; let available = false; let stopped = false;
  const settle = (job: Job, answer: NpcAnswer) => { if (!job.settled) { job.settled = true; job.resolve(answer); } };
  function remove(job: Job): void {
    jobs.delete(job);
    if (job.timeout) scheduler.clearTimeout(job.timeout);
    if (job.stuck) scheduler.clearTimeout(job.stuck);
    const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
  }
  function abort(job: Job, reason: 'cancelled' | 'timeout'): void {
    if (job.controller.signal.aborted) return;
    job.controller.abort(); settle(job, { ok: false, reason });
    if (!job.running) { remove(job); pump(); }
    else job.stuck = scheduler.setTimeout(() => logger.error('NPC не завершился после abort', { playerId: job.question.player.playerId }), 2000);
  }
  async function run(job: Job): Promise<void> {
    const q = job.question;
    try {
      const result = await responder.answer({ requestKey: `${q.connectionId}:${q.requestId}`, playerId: q.player.playerId, playerName: q.player.displayName, npc: q.npc, question: q.question, history: dialogue.history(q.player.playerId, q.npc.id).slice(-6), locale: 'ru', deadlineAt: job.deadline }, job.controller.signal);
      if (job.controller.signal.aborted) return;
      if (clock.now() >= job.deadline) { abort(job, 'timeout'); return; }
      const text = normalizeAnswer(result.text);
      if (!text) throw new Error('Empty answer');
      // Synchronous check + SQLite commit: cancellation cannot interleave here.
      dialogue.append(q.player.playerId, q.npc.id, q.question, text, clock.now());
      settle(job, { ok: true, text });
    } catch {
      if (!job.controller.signal.aborted) settle(job, { ok: false, reason: 'unavailable' });
    } finally { active--; remove(job); pump(); }
  }
  function pump(): void {
    while (!stopped && active < config.maxConcurrent && queue.length) {
      const job = queue.shift()!;
      if (clock.now() >= job.deadline) { abort(job, 'timeout'); continue; }
      job.running = true; active++; void run(job);
    }
  }
  return {
    async start() {
      stopped = false;
      try { await responder.start(); available = true; }
      catch { available = false; logger.error('NpcResponder недоступен'); }
    },
    ready: () => available && !stopped,
    ask(question) {
      if (!available || stopped) return Promise.resolve({ ok: false, reason: 'unavailable' });
      if ([...jobs].some((job) => job.question.player.playerId === question.player.playerId)) return Promise.resolve({ ok: false, reason: 'player-busy' });
      if (jobs.size >= config.maxUnfinished) return Promise.resolve({ ok: false, reason: 'server-busy' });
      return new Promise((resolve) => {
        const job: Job = { question, deadline: clock.now() + config.timeoutMs, controller: new AbortController(), running: false, settled: false, resolve };
        jobs.add(job); queue.push(job);
        job.timeout = scheduler.setTimeout(() => abort(job, 'timeout'), config.timeoutMs);
        pump();
      });
    },
    cancelConnection(connectionId) { for (const job of [...jobs]) if (job.question.connectionId === connectionId) abort(job, 'cancelled'); },
    async stop() {
      stopped = true; available = false;
      for (const job of [...jobs]) abort(job, 'cancelled');
      await responder.stop();
    },
  };
}
