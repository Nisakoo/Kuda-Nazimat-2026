import { randomBytes } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createLogger, type Logger, type LogsConfig } from '../common/logger.ts';
import { MetricsRegistry } from '../common/metrics.ts';
import { consoleSink, FileSink, fanOut } from './sinks.ts';
import { FlightRecorder } from './recorder.ts';

export interface Observability {
  readonly runId: string;
  readonly logger: Logger;
  readonly metrics: MetricsRegistry;
  readonly recorder: FlightRecorder;
  /** Last-minute process health for the operator screen (OBS-010). */
  process(): { eventLoopP99Ms: number; rssBytes: number };
  /** Extra state for incident dumps, registered by the composition root once modules exist. */
  setSnapshot(snapshot: () => unknown): void;
  close(): void;
}

/** OBS-001–004 wiring: console + file + flight recorder, process monitors; one per process. */
export function createObservability(logs: LogsConfig, options: { runId?: string; consoleWrite?: (line: string) => void; now?: () => number } = {}): Observability {
  const runId = options.runId ?? randomBytes(4).toString('hex');
  const now = options.now ?? Date.now;
  let snapshot: () => unknown = () => null;
  const metrics = new MetricsRegistry();
  const console = consoleSink(logs.consoleLevel, options.consoleWrite);
  const recorder = new FlightRecorder({ dir: logs.fileLevel === 'off' ? null : logs.dir, runId, now, snapshot: () => ({ metrics: metrics.snapshot(), state: snapshot() }) });
  let file: FileSink | null = null;
  // Sink trouble goes to the console only, so a broken disk cannot recurse into the file sink.
  const report = (event: 'log.sink.failed' | 'log.dropped', fields: Record<string, unknown>) => {
    if (event === 'log.dropped') metrics.counter('log_dropped_total', 'Строки лога, отброшенные при переполнении или сбое записи').inc({}, Number(fields.dropped) || 0);
    console({ ts: new Date(now()).toISOString(), seq: 0, runId, level: 'warn', module: 'obs', event, msg: event === 'log.dropped' ? 'Строки лога отброшены' : 'Не удалось записать лог в файл', ...fields });
  };
  if (logs.fileLevel !== 'off') file = new FileSink({ dir: logs.dir, runId, minLevel: logs.fileLevel, maxFileBytes: logs.maxFileMb << 20, maxTotalBytes: logs.maxTotalMb << 20, retentionMs: logs.retentionDays * 86_400_000, now, report });
  // OBS-013: records per level feed the error and warning counts of the history.
  const levels = metrics.counter('log_records_total', 'Записи журнала по уровню');
  const logger = createLogger(fanOut((record) => levels.inc({ level: record.level }), console, recorder.sink, ...(file ? [file.sink] : [])), runId, now);

  const delay = monitorEventLoopDelay({ resolution: 20 }); delay.enable();
  let last = { eventLoopP99Ms: 0, rssBytes: process.memoryUsage().rss };
  const lag = metrics.histogram('process_event_loop_delay_ms', 'Задержка event loop, p99 за минуту', [5, 10, 20, 50, 100, 200, 500, 1000]);
  metrics.gauge('process_resident_memory_bytes', 'RSS процесса', () => process.memoryUsage().rss);
  metrics.gauge('process_heap_used_bytes', 'Занятая куча V8', () => process.memoryUsage().heapUsed);
  metrics.gauge('process_uptime_seconds', 'Время работы процесса', () => Math.floor(process.uptime()));
  const monitor = setInterval(() => {
    const p99 = delay.percentile(99) / 1e6; delay.reset();
    const memory = process.memoryUsage();
    last = { eventLoopP99Ms: Number(p99.toFixed(1)), rssBytes: memory.rss };
    lag.observe(p99);
    logger.debug('process.memory', 'Память процесса', { rss: memory.rss, heapUsed: memory.heapUsed, external: memory.external, eventLoopP99Ms: last.eventLoopP99Ms });
    if (p99 > 50) logger.warn('process.event_loop_lag', 'Event loop задерживается', { p99Ms: last.eventLoopP99Ms });
  }, 60_000);
  monitor.unref();

  return {
    runId, logger, metrics, recorder,
    process: () => last,
    setSnapshot(next) { snapshot = next; },
    close() { clearInterval(monitor); delay.disable(); file?.close(); },
  };
}

/**
 * OBS-003: a crash is recorded with its stack and a flight-recorder dump before the process exits;
 * Node's own policy (exit on uncaught errors) is kept because the state may be inconsistent.
 */
export function installProcessHooks(obs: Observability, exit: (code: number) => void = (code) => process.exit(code)): () => void {
  const log = obs.logger.child('process');
  const crash = (event: string, msg: string) => (error: unknown) => {
    log.fatal(event, msg, { error });
    obs.recorder.dump(event);
    obs.close();
    exit(1);
  };
  const uncaught = crash('process.uncaught', 'Необработанное исключение');
  const rejection = crash('process.unhandled_rejection', 'Необработанный отказ промиса');
  const warning = (warning: Error) => log.warn('process.warning', 'Предупреждение Node', { error: warning });
  process.on('uncaughtException', uncaught); process.on('unhandledRejection', rejection); process.on('warning', warning);
  return () => { process.off('uncaughtException', uncaught); process.off('unhandledRejection', rejection); process.off('warning', warning); };
}
