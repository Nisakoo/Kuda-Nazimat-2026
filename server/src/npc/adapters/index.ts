import type { Clock, Scheduler } from '../../common/time.ts';
import type { NpcResponder } from '../NpcResponder.ts';
import { scripted } from './scripted.ts';
import { localLlm } from './localLlm.ts';
type Factory = (options: Record<string, unknown>, deps: { clock: Clock; scheduler: Scheduler }) => NpcResponder;
const adapters: Readonly<Record<string, Factory>> = {
  scripted,
  ollama: (options, deps) => localLlm('ollama', options, deps),
  mlx: (options, deps) => localLlm('mlx', options, deps),
};
export function createResponder(name: string, options: Record<string, unknown>, deps: { clock: Clock; scheduler: Scheduler }): NpcResponder {
  const factory = Object.hasOwn(adapters, name) ? adapters[name] : undefined;
  if (!factory) throw new Error(`Неизвестный npc.adapter: ${name}`);
  return factory(options, deps);
}
