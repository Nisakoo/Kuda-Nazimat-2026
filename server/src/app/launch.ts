import { resolve } from 'node:path';
import { loadServerConfig, serverArguments, type Environment as ServerEnvironment } from './config.ts';
import { selectLlmProfile } from './llmProfiles.ts';
import { NPC_TIMING } from '../../../shared/protocol/npcTiming.ts';

interface Selection { backend?: string; model?: string; profilesPath?: string }
type Environment = Readonly<Record<string, string | undefined>>;

/** Startup-only operator arguments. They never come from a game packet. */
export function launchArguments(args: readonly string[] = process.argv.slice(2), env: Environment = process.env): { configPath: string; env: ServerEnvironment; serverArgs: string[]; selection: Selection; npcTimeoutMs?: number } {
  const values = new Map<string, string>();
  const allowed = new Set(['--config', '--env', '--port', '--backend', '--model', '--profiles', '--npc-timeout']);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]; const value = args[i + 1];
    if (!flag || !allowed.has(flag) || values.has(flag) || !value || value.startsWith('--') || /[\x00-\x1f]/.test(value)) {
      throw new Error('Запуск: [--config <файл>] [--env development|production|test] [--port <порт>] [--backend ollama|mlx --model 2b|0.8b] [--profiles <файл>] [--npc-timeout <секунды>]');
    }
    values.set(flag, value);
  }
  const fromEnvironment = (name: string) => env[name]?.trim() || undefined;
  const cliPair = values.has('--backend') || values.has('--model');
  const backend = cliPair ? values.get('--backend') : fromEnvironment('KUDA_LLM_BACKEND');
  const model = cliPair ? values.get('--model') : fromEnvironment('KUDA_LLM_MODEL');
  if (Boolean(backend) !== Boolean(model)) throw new Error('Укажите BACKEND и MODEL вместе; сохранённый профиль не дополнит неполный выбор');
  if (backend !== undefined && !((backend === 'ollama' && (model === '2b' || model === '0.8b')) || (backend === 'mlx' && model === '2b'))) {
    throw new Error('Допустимы только ollama/2b, ollama/0.8b и mlx/2b');
  }
  const profilesPath = values.get('--profiles') ?? fromEnvironment('KUDA_LLM_PROFILES');
  const timeoutSeconds = values.get('--npc-timeout') ?? fromEnvironment('KUDA_NPC_TIMEOUT');
  let npcTimeoutMs: number | undefined;
  if (timeoutSeconds !== undefined) {
    const seconds = Number(timeoutSeconds);
    if (!/^[1-9]\d*$/.test(timeoutSeconds) || !Number.isSafeInteger(seconds) || seconds > NPC_TIMING.maxMs / 1000) {
      throw new Error(`NPC_TIMEOUT: укажите целое число от 1 до ${NPC_TIMING.maxMs / 1000} секунд`);
    }
    npcTimeoutMs = seconds * 1000;
  }
  const serverArgs = [...values].filter(([flag]) => ['--config', '--env', '--port'].includes(flag)).flat();
  const server = serverArguments(serverArgs, env);
  return {
    ...(npcTimeoutMs === undefined ? {} : { npcTimeoutMs }),
    configPath: server.configPath, env: server.env, serverArgs,
    selection: { ...(backend ? { backend, model: model! } : {}), ...(profilesPath ? { profilesPath: resolve(profilesPath) } : {}) },
  };
}

export async function loadLaunchConfig(args?: readonly string[], env?: Environment) {
  const { serverArgs, selection, npcTimeoutMs } = launchArguments(args, env);
  const { config: base } = await loadServerConfig(serverArgs, env);
  const config = npcTimeoutMs === undefined ? base : { ...base, npc: { ...base.npc, timeoutMs: npcTimeoutMs, streamTimeoutMs: npcTimeoutMs } };
  return selectLlmProfile(config, selection);
}
