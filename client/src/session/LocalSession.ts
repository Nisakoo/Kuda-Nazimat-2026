import { GameWorld } from '../core/GameWorld';
import type { Entity, EntityId, GameCommand, MovementBounds, WorldEvent, WorldSnapshot } from '../core/types';
import type { GameSession } from './GameSession';
import type { Vector3 } from '../core/types';

export class LocalSession implements GameSession {
  readonly mode = 'local';
  private readonly world: GameWorld;
  private commands: GameCommand[] = [];
  private readonly listeners = new Set<(events: readonly WorldEvent[]) => void>();
  private disposed = false;

  constructor(readonly playerId: EntityId, entities: readonly Entity[], bounds: MovementBounds | null = null) {
    if (!entities.some((entity) => entity.id === playerId && entity.character?.kind === 'player')) {
      throw new Error('Local player must be a player entity in the world.');
    }
    this.world = new GameWorld('local', entities, bounds);
  }

  send(command: GameCommand): void {
    this.assertActive();
    // A paused caller cannot build an unbounded movement backlog. Interactions are bounded too.
    if (command.type === 'move') {
      this.commands = this.commands.filter((pending) => pending.type !== 'move');
    }
    if (this.commands.length >= 64) throw new Error('Local command queue is full.');
    this.commands.push(command.type === 'move'
      ? { type: 'move', direction: { ...command.direction } }
      : { ...command });
  }

  update(deltaSeconds: number): void {
    this.assertActive();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) throw new Error('Step must be finite and positive.');
    const pending = this.commands;
    this.commands = [];
    for (const command of pending) this.world.execute(this.playerId, command);
    this.world.step(deltaSeconds);
    const events = this.world.drainEvents();
    if (events.length > 0) {
      for (const listener of this.listeners) listener(events);
    }
  }

  getSnapshot(): WorldSnapshot { return this.world.getSnapshot(); }
  setMovementGuard(guard: (position: Vector3) => boolean): void { this.world.setMovementGuard(guard); }
  setSurfaceHeight(height: (x: number, z: number) => number): void { this.world.setSurfaceHeight(height); }
  initializeSpawn(position: Vector3): void { this.world.initializePosition(this.playerId, position); }

  subscribe(listener: (events: readonly WorldEvent[]) => void): () => void {
    this.assertActive();
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.commands = [];
    this.listeners.clear();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('LocalSession is disposed.');
  }
}
