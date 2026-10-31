import { describe, expect, it, vi } from 'vitest';
import type { Entity, GameCommand } from '../core/types';
import type { GameSession } from './GameSession';
import { LocalSession } from './LocalSession';
import { initialMotion, motionStatus, stepMotion } from '../../../shared/movement/simulation.ts';

const entities: readonly Entity[] = [
  {
    id: 'player', character: { kind: 'player', name: 'Player' },
    transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0 },
    movement: { direction: { x: 0, z: 0 }, speed: 1 },
  },
  {
    id: 'npc', character: { kind: 'npc', name: 'Guide' },
    transform: { position: { x: 2, y: 0, z: 0 }, rotationY: 0 },
    interactable: { radius: 2, label: 'Talk' },
  },
  { id: 'visitor', character: { kind: 'player', name: 'Local visitor' } },
];

describe('LocalSession without a browser or network', () => {
  it('uses shared kinetics for sprint/jump and clears an unconsumed jump before resuming', () => {
    const session = new LocalSession('player', [{ ...entities[0]!, movement: { direction: { x: 0, z: 0 }, speed: 3 } }]);
    let state = initialMotion({ x: 0, y: 0, z: 0 });
    const env = { canTraverse: () => true, canOccupy: () => true, canRecover: () => true, heightAt: () => 0, ceilings: [], spawn: state.position };
    session.send({ type: 'move', direction: { x: 1, z: 0 } }); session.send({ type: 'sprint', held: true }); session.send({ type: 'jump' });
    for (let i = 0; i < 30; i++) {
      session.update(.05); state = stepMotion(state, { direction: { x: 1, z: 0 }, sprint: true, jumpId: 1 }, .05, env);
      expect(session.getSnapshot().entities[0]!.transform!.position).toEqual(state.position);
      expect(session.getSnapshot().entities[0]!.motion).toEqual(motionStatus(state));
    }
    session.send({ type: 'jump' }); session.send({ type: 'clear-input' }); session.update(.05);
    expect(session.getSnapshot().entities[0]!.motion).toMatchObject({ grounded: true, jumpAck: 1, locomotion: 'idle' });
    session.dispose();
  });
  it('executes movement and interactions through the common session contract', () => {
    const session: GameSession = new LocalSession('player', entities);
    const events = vi.fn();
    session.subscribe(events);
    session.send({ type: 'interact', targetId: 'npc' });
    session.send({ type: 'move', direction: { x: 1, z: 0 } });
    expect(session.getSnapshot().tick).toBe(0);
    session.update(1);
    expect(session.getSnapshot().entities[0]?.transform?.position.x).toBeCloseTo(1, 8);
    expect(events).toHaveBeenCalledWith(expect.arrayContaining([{ type: 'interacted', actorId: 'player', targetId: 'npc' }]));
    expect(session.mode).toBe('local');
    expect(session.playerId).toBe('player');
    expect(session.getSnapshot().entities[2]?.character?.kind).toBe('player');
    session.dispose();
  });

  it('copies queued commands and coalesces movement while preserving interactions', () => {
    const session = new LocalSession('player', entities);
    const command = { type: 'move' as const, direction: { x: -1, z: 0 } };
    session.send(command);
    command.direction.x = 99;
    session.update(1);
    expect(session.getSnapshot().entities[0]?.transform?.position.x).toBeCloseTo(-1, 8);
    for (let index = 0; index < 100; index++) session.send({ type: 'move', direction: { x: 1, z: 0 } });
    session.send({ type: 'interact', targetId: 'npc' });
    session.send({ type: 'move', direction: { x: 0, z: 0 } });
    session.update(1);
    expect(session.getSnapshot().entities[0]?.transform?.position.x).toBeCloseTo(-1, 8);
    session.dispose();
  });

  it('bounds interaction queues and rejects updates after disposal', () => {
    const session = new LocalSession('player', entities);
    const listener = vi.fn();
    session.subscribe(listener);
    const command: GameCommand = { type: 'interact', targetId: 'npc' };
    for (let index = 0; index < 64; index++) session.send(command);
    expect(() => session.send(command)).toThrow('full');
    session.dispose();
    session.dispose();
    expect(() => session.send(command)).toThrow('disposed');
    expect(() => session.update(1)).toThrow('disposed');
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribes and does not consume queued commands on an invalid step', () => {
    const session = new LocalSession('player', entities);
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    unsubscribe();
    session.send({ type: 'move', direction: { x: 1, z: 0 } });
    expect(() => session.update(NaN)).toThrow();
    session.update(1);
    expect(session.getSnapshot().entities[0]?.transform?.position.x).toBeCloseTo(1, 8);
    expect(listener).not.toHaveBeenCalled();
    session.dispose();
  });

  it('requires the chosen local player to exist as a player', () => {
    expect(() => new LocalSession('unknown', entities)).toThrow('Local player');
    expect(() => new LocalSession('npc', entities)).toThrow('Local player');
  });
});
