import { GameWorld } from '../core/GameWorld';
import type { Entity } from '../core/types';
import type { Clock } from './NetworkAdapter';
import { MockNetworkAdapter } from './MockNetworkAdapter';
import { DEMO_NPCS } from '../shared/demo';
import { DEMO_WORLD, SCIENCE_WORLD } from '../shared/demoWorld.generated';

/** Synthetic peer for manually exercising client states. This is not a game server. */
export function createMockDemo(clock: Clock): MockNetworkAdapter {
  let world: GameWorld;
  let revision = 0;
  let chats = 0;
  return new MockNetworkAdapter(clock, (message, transport) => {
    if (message.type === 'join') {
      const spawn = { x: 0, y: 0, z: message.mapId === 'science' ? 38 : 6 };
      const entities: Entity[] = [
        ...['mock-player', 'mock-peer'].map((id, i): Entity => ({ id, character: { kind: 'player', name: i ? 'Тестовый участник' : 'Исследователь' }, transform: { position: { ...spawn, x: i * 3 }, rotationY: Math.PI }, movement: { direction: { x: 0, z: 0 }, speed: 3 }, renderable: { assetId: 'demo-player' }, animationState: { name: 'idle' } })),
        ...DEMO_NPCS.map((npc): Entity => ({ id: npc.id, character: { kind: 'npc', name: npc.name }, transform: { position: { x: npc.x, y: 0, z: npc.z }, rotationY: 0 }, interactable: { radius: 2.2, label: 'Поговорить' }, renderable: { assetId: npc.id } })),
      ];
      world = new GameWorld('local', entities); revision = 0;
      transport.receive({ v: 1, type: 'joined', requestId: message.requestId, playerId: 'mock-player', revision, snapshot: world.getSnapshot(), world: message.mapId === 'science' ? SCIENCE_WORLD : DEMO_WORLD });
    } else if (message.type === 'input' && world) {
      world.execute('mock-player', { type: 'move', direction: message.direction });
      world.execute('mock-peer', { type: 'move', direction: { x: Math.sin(clock.now() / 1500) * 0.2, z: 0 } });
      world.step(0.05); world.drainEvents();
      if (world.getSnapshot().tick % 2 === 0) transport.receive({ v: 1, type: 'delta', baseRevision: revision, revision: ++revision, tick: world.getSnapshot().tick, upsert: world.getSnapshot().entities, remove: [] });
    } else if (message.type === 'resync' && world) {
      transport.receive({ v: 1, type: 'snapshot', revision, snapshot: world.getSnapshot() });
    } else if (message.type === 'interact' && world) {
      const result = world.execute('mock-player', { type: 'interact', targetId: message.targetId }); world.drainEvents();
      if (result.ok) transport.receive({ v: 1, type: 'interacted', requestId: message.requestId, targetId: message.targetId });
      else transport.receive({ v: 1, type: 'error', requestId: message.requestId, code: 'FORBIDDEN', message: 'Тестовый NPC слишком далеко.' });
    } else if (message.type === 'npc-question') {
      transport.receive({ v: 1, type: 'npc-answer', requestId: message.requestId, targetId: message.targetId, text: `Тестовый ответ на «${message.text}». Это проверка сетевого клиента; адаптивный ИИ работает только на отдельном сервере.` }, 250);
    } else if (message.type === 'chat-send') {
      transport.receive({ v: 1, type: 'chat', requestId: message.requestId, messageId: `m${++chats}`, playerId: 'mock-player', name: 'Вы', text: message.text });
      transport.receive({ v: 1, type: 'chat', requestId: `peer${chats}`, messageId: `m${++chats}`, playerId: 'mock-peer', name: 'Тестовый участник', text: 'Сообщение получено тестовым транспортом.' }, 180);
    }
  });
}
