import { expect, it } from 'vitest';
import { MetricsRegistry } from '../src/common/metrics.ts';
import { memoryLogger } from '../src/common/logger.ts';
import { setup } from './harness.ts';

it('ADMIN S1–S6: access, monitoring, live NPC edits, map-figure refusal, change log, account actions and audit', async () => {
  const metrics = new MetricsRegistry(); const logger = memoryLogger();
  const { post, origin, connect } = await setup({}, undefined, 'test', logger, { metrics });
  const page = await fetch(`${origin}/admin`);
  expect(page.status).toBe(200); expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'"); expect(await page.text()).toContain('/api/admin/login');

  const get = (path: string, token?: string) => fetch(`${origin}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const game = (await post('/api/auth/dev', { name: 'Аня' })).body!.token as string;
  expect((await get('/api/admin/status')).status).toBe(401);
  expect((await get('/api/admin/status', game)).status).toBe(403);
  const admin = (await post('/api/admin/dev', {})).body!.token as string;
  const auth = { Authorization: `Bearer ${admin}` };

  // S2: monitoring with a connected player.
  const player = await connect(game); player.command('join', { mapId: 'test' }); await player.wait((p) => p.type === 'joined');
  const status = await (await get('/api/admin/status', admin)).json() as Record<string, any>;
  expect(status).toMatchObject({ admin: 'admin', env: 'test', seats: { used: 1, max: 4 }, npcReady: true, health: { level: expect.any(String) } });
  expect(status.server.npc).toMatchObject({ queued: 0, running: 0, unfinished: 0 });
  expect(status.server.memory.rss).toBeGreaterThan(0);
  expect(status.players[0]).toMatchObject({ name: 'Аня', connected: true, ip: expect.stringContaining('127.0.0.1'), perf: null });

  // S3: a behaviour edit applies to the very next question, without a restart.
  const npcs = (await (await get('/api/admin/npcs', admin)).json() as { npcs: Record<string, any>[] }).npcs;
  expect(npcs[0]).toMatchObject({ id: 'guide', figure: 'map', state: 'active', revision: 1, restrictions: { mapFigure: true, babelRequired: false } });
  const patch = (body: unknown) => fetch(`${origin}/api/admin/npcs/guide`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(body) });
  const updated = await patch({ revision: 1, greeting: 'Новое приветствие гида.', topic: 'Новая тема' });
  expect(updated.status).toBe(200); expect(((await updated.json()) as { npc: unknown }).npc).toMatchObject({ revision: 2, greeting: 'Новое приветствие гида.' });
  const question = player.command('npc-question', { targetId: 'guide', text: 'Расскажи' });
  const answer = await player.wait((p) => p.type === 'npc-answer' && p.requestId === question);
  expect(answer.type === 'npc-answer' && answer.text).toMatch(/^Новое приветствие гида\./);
  await player.wait((p) => p.type === 'delta' && p.upsert.some((e) => e.id === 'guide' && e.interactable?.label === 'Новая тема'));

  // CONTENT-011: a stale revision gets 409 with the current record.
  const stale = await patch({ revision: 1, persona: 'Другая' });
  expect(stale.status).toBe(409); expect(((await stale.json()) as { current: unknown }).current).toMatchObject({ revision: 2, updatedBy: 'admin' });

  // S4: the map figure cannot be moved, disabled or deleted.
  for (const action of ['move', 'disable', 'delete']) {
    const refused = await post(`/api/admin/npcs/guide/${action}`, { revision: 2, ...(action === 'move' ? { x: 1, z: 6 } : {}) }, auth);
    expect(refused).toMatchObject({ status: 403, body: { error: { message: 'Фигура нарисована в модели карты — нужна поддержка клиента.' } } });
  }

  // ADMIN-009: the change log comes from the database with author and IP.
  const changes = (await (await get('/api/admin/changes?npcId=guide', admin)).json() as { changes: Record<string, any>[] }).changes;
  expect(changes[0]).toMatchObject({ action: 'update', actorName: 'admin', ip: expect.stringContaining('127.0.0.1'), changes: { greeting: { to: 'Новое приветствие гида.' } } });

  // Accounts and S6 audit.
  expect(await post('/api/admin/accounts/revoke', { name: 'Аня' }, auth)).toMatchObject({ status: 200, body: { revoked: 1 } });
  await player.wait((p) => p.type === 'error' && p.requestId === 'server');
  expect(metrics.prometheus()).toContain('admin_actions_total{action="npc.update",result="ok"} 1');
  expect(metrics.prometheus()).toContain('admin_actions_total{action="npc.move",result="FORBIDDEN"} 1');
  expect(logger.records.filter((r) => r.event === 'admin.action').length).toBeGreaterThanOrEqual(6);
  expect(JSON.stringify(logger.records)).not.toContain('Новое приветствие гида.');
  expect((await fetch(`${origin}/api/admin/logout`, { method: 'POST', headers: auth })).status).toBe(204);
  expect((await get('/api/admin/status', admin)).status).toBe(401);
});
