import type { AppleState, HandRequest, HandResultMessage, WorldLifeDefinition } from '../../../shared/world-life/types.ts';

/** Durable boundary. execute reads, decides, updates the apple and writes the receipt in one transaction. */
export interface WorldLifeStore {
  initialize(definitions: readonly WorldLifeDefinition[], restore?: (apples: readonly AppleState[]) => readonly AppleState[]): readonly AppleState[];
  execute(playerId: string, mapId: string, request: HandRequest, decide: (apples: readonly AppleState[]) => HandResultMessage): { readonly result: HandResultMessage; readonly apples: readonly AppleState[]; readonly changed: boolean };
}
