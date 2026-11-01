import { resolve } from 'node:path';
import { defaultConfigPath, loadConfig } from './config.ts';
import { selectLlmProfile } from './llmProfiles.ts';

interface Selection { backend?: string; model?: string; profilesPath?: string }
type Environment = Readonly<Record<string, string | undefined>>;

/** Startup-only operator arguments. They never come from a game packet. */
export function launchArguments(args: readonly string[] = process.argv.slice(2), env: Environment = process.env): { configPath: string; selection: Selection } {
  const values = new Map<string, string>();
  const allowed = new Set(['--config', '--backend', '--model', '--profiles']);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]; const value = args[i + 1];
    if (!flag || !allowed.has(flag) || values.has(flag) || !value || value.startsWith('--') || /[\x00-\x1f]/.test(value)) {
      throw new Error('Запуск: --config <файл> [--backend ollama|mlx --model 2b|0.8b] [--profiles <файл>]');
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
  return {
    configPath: values.has('--config') ? resolve(values.get('--config')!) : defaultConfigPath,
    selection: { ...(backend ? { backend, model: model! } : {}), ...(profilesPath ? { profilesPath: resolve(profilesPath) } : {}) },
  };
}

export async function loadLaunchConfig(args?: readonly string[], env?: Environment) {
  const { configPath, selection } = launchArguments(args, env);
  return selectLlmProfile(await loadConfig(configPath), selection);
}
