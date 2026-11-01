import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerConfig } from '../app/config.ts';
import { frameFromJson, summarize, type Frame } from '../obs/history.ts';
import { reportTable } from '../obs/thresholds.ts';

/**
 * OBS-017 acceptance report from the server journal, without a running server:
 * `npm --prefix server run report [-- --env <env>] [--file <path>] [--since <ISO> | --last <2h>]`.
 */
const USAGE = 'Использование: npm --prefix server run report -- [--env development|production|test] [--config <путь>] [--file <журнал.jsonl>] [--since <ISO-время> | --last <длительность: 30m, 2h, 1d>]';
const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)([smhd])$/.exec(value);
  if (!match) throw new Error(`Неверная длительность «${value}». ${USAGE}`);
  return Number(match[1]) * UNITS[match[2]!]!;
}

interface Record_ { readonly ts?: string; readonly runId?: string; readonly event?: string; readonly env?: string; readonly [key: string]: unknown }

/** Report over journal records: one run (`runId`) or everything since `since`. */
export function reportFromRecords(records: readonly Record_[], select: { runId: string } | { since: number }): string {
  const chosen = records.filter((r) => ('runId' in select ? r.runId === select.runId : Date.parse(r.ts ?? '') >= select.since));
  const frames = chosen.filter((r) => r.event === 'metrics.minute').map(frameFromJson).filter((f): f is Frame => f !== null).sort((a, b) => a.at - b.at);
  const summary = summarize(frames);
  const starts = chosen.filter((r) => r.event === 'app.start');
  const runIds = [...new Set(chosen.map((r) => r.runId).filter((id): id is string => typeof id === 'string'))];
  const from = summary.from ?? (chosen[0]?.ts ? Date.parse(chosen[0].ts) : null);
  const to = summary.to ?? (chosen.at(-1)?.ts ? Date.parse(chosen.at(-1)!.ts!) : null);
  return reportTable(summary, { runIds, env: starts.map((r) => r.env).filter((e): e is string => typeof e === 'string').at(-1) ?? null, from, to, peakPlayers: summary.seatedPeak });
}

/** Reads the journal lines the report needs; other events are skipped before parsing. */
export function readRecords(files: readonly string[]): Record_[] {
  const records: Record_[] = [];
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"metrics.minute"') && !line.includes('"app.start"')) continue;
      try { records.push(JSON.parse(line) as Record_); } catch { /* a torn last line after a crash */ }
    }
  }
  return records.sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));
}

const runOf = (file: string): string | undefined => /^server-\d+-(.+?)(?:-\d+)?\.jsonl$/.exec(basename(file))?.[1];

/** Server journal files, newest first. */
function journalFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => /^server-.*\.jsonl$/.test(name)).map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

async function main(argv: string[]): Promise<void> {
  const rest: string[] = []; let file: string | undefined; let since: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!; const value = argv[i + 1];
    if (flag === '--file' && value) { file = resolve(value); i++; }
    else if (flag === '--since' && value) { since = Date.parse(value); if (Number.isNaN(since)) throw new Error(`Неверное время «${value}». ${USAGE}`); i++; }
    else if (flag === '--last' && value) { since = Date.now() - parseDuration(value); i++; }
    else if (flag === '--help' || flag === '-h') { process.stdout.write(`${USAGE}\n`); return; }
    else rest.push(flag);
  }
  let files: string[];
  if (file) files = [file];
  else {
    const { config } = await loadServerConfig(rest);
    try { files = journalFiles(config.logs.dir); } catch { throw new Error(`Нет каталога журнала ${config.logs.dir}`); }
  }
  if (!files.length) { process.stdout.write('Нет данных: журнал пуст.\n'); return; }
  if (since !== undefined) { process.stdout.write(reportFromRecords(readRecords(files), { since })); return; }
  // Default: the latest run; its rotated parts share the runId in the file name.
  const runId = file ? undefined : runOf(files[0]!);
  const records = readRecords(runId ? files.filter((name) => runOf(name) === runId) : files);
  const selected = runId ?? records.at(-1)?.runId;
  if (!selected) { process.stdout.write('Нет данных: в журнале нет записей запуска.\n'); return; }
  process.stdout.write(reportFromRecords(records, { runId: selected }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
