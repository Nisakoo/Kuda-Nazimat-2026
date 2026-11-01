/**
 * Structured log port (OBS-001). `event` is a stable machine id from the OBS catalogue, `msg` a short
 * human text. Callers pass IDs, codes and durations only — never tokens, passwords or player texts (OBS-006).
 */
export const LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type Level = (typeof LEVELS)[number];
export type Fields = Readonly<Record<string, unknown>>;
/** Sink configuration (SERVER-004 `logs`, OBS-002). */
export interface LogsConfig { consoleLevel: Level; fileLevel: Level | 'off'; dir: string; maxFileMb: number; maxTotalMb: number; retentionDays: number }

export interface Logger {
  debug(event: string, msg: string, fields?: Fields): void;
  info(event: string, msg: string, fields?: Fields): void;
  warn(event: string, msg: string, fields?: Fields): void;
  error(event: string, msg: string, fields?: Fields): void;
  fatal(event: string, msg: string, fields?: Fields): void;
  /** Same sink, another module and/or bound context (playerId, connectionId, …). */
  child(module: string, context?: Fields): Logger;
}

export interface LogRecord {
  readonly ts: string; readonly seq: number; readonly runId: string; readonly level: Level;
  readonly module: string; readonly event: string; readonly msg: string;
  readonly [field: string]: unknown;
}
export type LogSink = (record: LogRecord) => void;

export const levelRank = (level: Level): number => LEVELS.indexOf(level);

/** Errors become {name, message, code, stack}; anything else is kept as is. */
export function serializeError(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  const code = (value as NodeJS.ErrnoException).code;
  return { name: value.name, message: value.message, ...(code ? { code } : {}), ...(value.stack ? { stack: value.stack } : {}), ...(value.cause ? { cause: serializeError(value.cause) } : {}) };
}

const RESERVED = new Set(['ts', 'seq', 'runId', 'level', 'module', 'event', 'msg']);

export function createLogger(sink: LogSink, runId: string, now: () => number = Date.now, module = 'app', context: Fields = {}, counter = { seq: 0 }): Logger {
  const write = (level: Level) => (event: string, msg: string, fields: Fields = {}): void => {
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({ ...context, ...fields })) {
      if (value === undefined) continue;
      extra[RESERVED.has(key) ? `field_${key}` : key] = key === 'error' ? serializeError(value) : value;
    }
    try { sink({ ts: new Date(now()).toISOString(), seq: ++counter.seq, runId, level, module, event, msg, ...extra }); }
    catch { /* A failing sink must never break the caller; sinks report their own failures. */ }
  };
  return {
    debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error'), fatal: write('fatal'),
    child: (name, bound = {}) => createLogger(sink, runId, now, name, { ...context, ...bound }, counter),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child: () => silentLogger };

/** Collects records in memory; for tests and diagnostics. */
export function memoryLogger(records: LogRecord[] = [], runId = 'test'): Logger & { records: LogRecord[] } {
  return Object.assign(createLogger((record) => { records.push(record); }, runId), { records });
}
