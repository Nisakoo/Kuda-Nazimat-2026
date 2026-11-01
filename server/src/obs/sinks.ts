import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { levelRank, type Level, type LogRecord, type LogSink } from '../common/logger.ts';

const HEAD = new Set(['ts', 'seq', 'runId', 'level', 'module', 'event', 'msg']);

/** Human-readable line for the operator's console; not an interface (OBS-002). */
export function consoleSink(minLevel: Level, write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): LogSink {
  return (record) => {
    if (levelRank(record.level) < levelRank(minLevel)) return;
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) if (!HEAD.has(key)) fields[key] = value;
    const error = fields.error as { stack?: string; message?: string } | undefined;
    if (error) delete fields.error;
    const rest = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
    write(`${record.ts.slice(11, 23)} ${record.level.toUpperCase().padEnd(5)} [${record.module}] ${record.msg} (${record.event})${rest}${error ? `\n  ${error.stack ?? error.message}` : ''}`);
  };
}

export interface FileSinkOptions {
  readonly dir: string; readonly runId: string; readonly minLevel: Level;
  readonly maxFileBytes: number; readonly maxTotalBytes: number; readonly retentionMs: number;
  readonly bufferBytes?: number; readonly flushMs?: number; readonly retryMs?: number;
  readonly now?: () => number;
  /** Reports the sink's own trouble somewhere else (console). */
  readonly report?: (event: 'log.sink.failed' | 'log.dropped', fields: Record<string, unknown>) => void;
}

/**
 * JSONL file with size rotation, total size and age limits (OBS-002). Lines are buffered and appended
 * in batches; error/fatal flush immediately. Overflow and write failures drop lines and are counted.
 */
export class FileSink {
  readonly sink: LogSink;
  private buffer: string[] = [];
  private bufferedBytes = 0;
  private fileBytes = 0;
  private part = 0;
  private file = '';
  private dropped = 0;
  private failedUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly options: Required<Omit<FileSinkOptions, 'report'>> & Pick<FileSinkOptions, 'report'>;

  constructor(options: FileSinkOptions) {
    this.options = { bufferBytes: 1 << 20, flushMs: 250, retryMs: 60_000, now: Date.now, ...options };
    this.sink = (record) => this.write(record);
    this.open();
    this.timer = setInterval(() => this.flush(), this.options.flushMs);
    this.timer.unref();
  }

  get droppedLines(): number { return this.dropped; }
  get currentFile(): string { return this.file; }

  private open(): void {
    const date = new Date(this.options.now()).toISOString().slice(0, 10).replaceAll('-', '');
    this.file = join(this.options.dir, `server-${date}-${this.options.runId}${this.part ? `-${this.part}` : ''}.jsonl`);
    this.fileBytes = 0;
    try { mkdirSync(this.options.dir, { recursive: true }); this.prune(); }
    catch (error) { this.fail(error); }
  }

  private write(record: LogRecord): void {
    if (levelRank(record.level) < levelRank(this.options.minLevel)) return;
    const line = `${JSON.stringify(record)}\n`;
    if (this.bufferedBytes + line.length > this.options.bufferBytes) { this.dropped++; return; }
    this.buffer.push(line); this.bufferedBytes += line.length;
    if (levelRank(record.level) >= levelRank('error')) this.flush();
  }

  /** Synchronous so that a fatal record is on disk before the process exits. */
  flush(): void {
    if (!this.buffer.length || this.options.now() < this.failedUntil) {
      if (this.options.now() < this.failedUntil && this.buffer.length) { this.dropped += this.buffer.length; this.buffer = []; this.bufferedBytes = 0; }
      return;
    }
    const chunk = this.buffer.join(''); this.buffer = []; this.bufferedBytes = 0;
    try {
      appendFileSync(this.file, chunk);
      this.fileBytes += Buffer.byteLength(chunk);
      if (this.fileBytes >= this.options.maxFileBytes) { this.part++; this.open(); }
    } catch (error) { this.dropped += chunk.split('\n').length - 1; this.fail(error); }
    if (this.dropped && this.options.report) { this.options.report('log.dropped', { dropped: this.dropped }); this.dropped = 0; }
  }

  close(): void { if (this.timer) clearInterval(this.timer); this.timer = null; this.flush(); }

  private fail(error: unknown): void {
    this.failedUntil = this.options.now() + this.options.retryMs;
    this.options.report?.('log.sink.failed', { dir: this.options.dir, code: (error as NodeJS.ErrnoException).code ?? 'unknown' });
  }

  /** Oldest first: anything past retention, then whatever exceeds the total size. */
  private prune(): void {
    const files = readdirSync(this.options.dir).filter((name) => name.endsWith('.jsonl')).map((name) => {
      const path = join(this.options.dir, name); const info = statSync(path);
      return { path, bytes: info.size, mtime: info.mtimeMs };
    }).sort((a, b) => a.mtime - b.mtime);
    let total = files.reduce((sum, file) => sum + file.bytes, 0);
    const cutoff = this.options.now() - this.options.retentionMs;
    for (const file of files) {
      if (file.path === this.file) continue;
      if (file.mtime < cutoff || total > this.options.maxTotalBytes - this.options.maxFileBytes) { unlinkSync(file.path); total -= file.bytes; }
    }
  }
}

/** Fans one record out to several sinks; a throwing sink does not stop the others. */
export function fanOut(...sinks: LogSink[]): LogSink {
  return (record) => { for (const sink of sinks) { try { sink(record); } catch { /* reported by the sink itself */ } } };
}
