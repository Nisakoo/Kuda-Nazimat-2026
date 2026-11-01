import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '../common/logger.ts';
import { ContentError } from '../content/NpcCatalog.ts';
import type { ContentAdmin } from '../content/ContentAdmin.ts';
import type { JournalEntry, JournalFilter, JournalTarget } from '../content/ports.ts';
import { BodyError, body, clientIp, error, json, type RequestContext } from './util.ts';

const STATUS = { INVALID: 400, NOT_FOUND: 404, CONFLICT: 409 } as const;
const BODY_LIMIT = 8192;
const CSV_ROWS = 10_000;
const TARGETS: readonly JournalTarget[] = ['npc', 'world', 'account'];
const NPC = /^\/api\/operator\/npcs\/([A-Za-z0-9_-]{1,80})(?:\/(restore|reset))?$/;
const SCENE = /^\/api\/operator\/world\/([A-Za-z0-9_-]{1,80})\/reset-scene$/;

function time(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new ContentError('INVALID', 'Период: время в миллисекундах или ISO 8601.');
  return parsed;
}
function journalFilter(params: URLSearchParams, csv: boolean): JournalFilter {
  const target = params.get('target') || undefined;
  if (target !== undefined && !TARGETS.includes(target as JournalTarget)) throw new ContentError('INVALID', 'Цель: npc, world или account.');
  const pageSize = csv ? CSV_ROWS : Math.min(200, Math.max(1, Number(params.get('pageSize') ?? 50) || 50));
  const page = csv ? 1 : Math.max(1, Math.floor(Number(params.get('page') ?? 1)) || 1);
  const pick = (key: string) => params.get(key)?.slice(0, 200) || undefined;
  const from = time(params.get('from')); const to = time(params.get('to'));
  return {
    ...(target ? { target: target as JournalTarget } : {}), ...(pick('id') ? { id: pick('id')! } : {}), ...(pick('action') ? { action: pick('action')! } : {}), ...(pick('q') ? { q: pick('q')! } : {}),
    ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }),
    order: params.get('order') === 'asc' ? 'asc' : 'desc', offset: (page - 1) * pageSize, limit: pageSize,
  };
}
/** RFC 4180 cell; a leading = + - @ is neutralised so spreadsheets do not run it as a formula. */
function cell(value: unknown): string {
  let text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function csv(entries: readonly JournalEntry[]): string {
  const header = ['id', 'время', 'автор', 'ip', 'цель', 'идентификатор', 'действие', 'было', 'стало'];
  const rows = entries.map((e) => [e.id, new Date(e.at).toISOString(), e.actor, e.ip, e.targetType, e.targetId, e.action, e.before, e.after].map(cell).join(','));
  return `\uFEFF${[header.join(','), ...rows].join('\r\n')}\r\n`;
}

/**
 * ADMIN-SRV-012: NPC, world, journal and account routes of the operator screen. The caller has already
 * checked loopback; `trusted` is the AUTH-010 CSRF guard for changes. False when the path is not ours.
 */
export async function handleAdminContent(req: IncomingMessage, res: ServerResponse, path: string, admin: ContentAdmin, trusted: () => boolean, logger: Logger, context: RequestContext): Promise<boolean> {
  const method = req.method ?? 'GET';
  const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const npc = NPC.exec(path); const scene = SCENE.exec(path);
  const ours = path === '/api/operator/npcs' || npc || scene || ['/api/operator/world', '/api/operator/journal', '/api/operator/journal.csv', '/api/operator/accounts', '/api/operator/account'].includes(path);
  if (!ours) return false;
  context.route = npc ? `/api/operator/npcs/:id${npc[2] ? `/${npc[2]}` : ''}` : scene ? '/api/operator/world/:mapId/reset-scene' : path;
  const changing = method !== 'GET' && method !== 'HEAD';
  if (changing && !trusted()) {
    req.resume();
    logger.warn('auth.operator.rejected', 'Действие администратора без правильного Origin или X-Operator', { origin: req.headers.origin ?? null, route: context.route });
    error(res, 403, 'FORBIDDEN', 'Действие доступно только со страницы администратора.'); return true;
  }
  const input = async (): Promise<Record<string, unknown>> => {
    let value: unknown;
    try { value = await body(req, BODY_LIMIT); } catch (cause) { if (cause instanceof BodyError) throw new ContentError('INVALID', 'Ожидается JSON до 8 КиБ.'); throw cause; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContentError('INVALID', 'Ожидается JSON-объект.');
    return value as Record<string, unknown>;
  };
  const empty = async (): Promise<void> => { if (req.headers['content-type'] && Object.keys(await input()).length) throw new ContentError('INVALID', 'Тело должно быть пустым объектом.'); else req.resume(); };
  const ip = clientIp(req);
  try {
    if (path === '/api/operator/npcs' && method === 'GET') { json(res, 200, admin.list({ ...(params.get('map') ? { map: params.get('map')! } : {}), ...(params.get('q') ? { q: params.get('q')! } : {}), deleted: params.get('deleted') === '1' })); return true; }
    if (path === '/api/operator/npcs' && method === 'POST') { json(res, 201, { npc: admin.create(await input(), ip) }); return true; }
    if (npc && !npc[2] && method === 'GET') { json(res, 200, admin.get(npc[1]!)); return true; }
    if (npc && !npc[2] && method === 'PATCH') { json(res, 200, { npc: admin.update(npc[1]!, await input(), ip) }); return true; }
    if (npc && !npc[2] && method === 'DELETE') { req.resume(); json(res, 200, { npc: admin.remove(npc[1]!, ip) }); return true; }
    if (npc?.[2] && method === 'POST') { await empty(); json(res, 200, { npc: npc[2] === 'restore' ? admin.restore(npc[1]!, ip) : admin.reset(npc[1]!, ip) }); return true; }
    if (path === '/api/operator/world' && method === 'GET') { json(res, 200, admin.world()); return true; }
    if (scene && method === 'POST') { await empty(); json(res, 200, admin.resetScene(scene[1]!, ip)); return true; }
    if (path === '/api/operator/journal' && method === 'GET') {
      const filter = journalFilter(params, false);
      json(res, 200, { ...admin.journal(filter), page: filter.offset / filter.limit + 1, pageSize: filter.limit }); return true;
    }
    if (path === '/api/operator/journal.csv' && method === 'GET') {
      const text = csv(admin.journal(journalFilter(params, true)).entries);
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="journal.csv"', 'Content-Length': Buffer.byteLength(text) });
      res.end(text); return true;
    }
    if (path === '/api/operator/accounts' && method === 'GET') { json(res, 200, { accounts: admin.accounts(params.get('q') ?? '') }); return true; }
    if (path === '/api/operator/account' && method === 'GET') { json(res, 200, { account: admin.account(params.get('name') ?? '') }); return true; }
    req.resume(); res.writeHead(404); res.end(); return true;
  } catch (cause) {
    if (cause instanceof ContentError) { error(res, STATUS[cause.code], cause.code, cause.message); return true; }
    logger.error('db.transaction.failed', 'Изменение администратора не сохранено', { route: context.route, error: cause });
    error(res, 503, 'UNAVAILABLE', 'Не удалось сохранить изменение. Повторите позже.'); return true;
  }
}
