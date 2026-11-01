import { access } from 'node:fs/promises';
import type { CreateGame } from '../contracts.ts';
import { consoleLogger } from '../common/logger.ts';
import { shutdownOnSignals } from './shutdown.ts';
import { startApplication } from './application.ts';
import { loadLaunchConfig } from './launch.ts';
const logger = consoleLogger();
try {
  const { config, profile } = await loadLaunchConfig();
  const options = config.npc.options;
  const model = profile?.model ?? (config.npc.adapter === 'scripted' ? 'scripted' : options.model === 'qwen3.5:0.8b-q8_0' ? '0.8b' : options.model === 'qwen3.5:2b-q4_K_M' || config.npc.adapter === 'mlx' ? '2b' : 'configured');
  const fields: Record<string, string | number> = {
    backend: ['ollama', 'mlx', 'scripted'].includes(config.npc.adapter) ? config.npc.adapter : 'configured',
    model, timeoutMs: config.npc.timeoutMs, source: profile ? 'prepared-profile' : 'legacy-config',
  };
  if (config.npc.adapter === 'mlx') fields.compute = 'metal';
  if (config.npc.adapter === 'ollama') {
    fields.compute = typeof options.numGpu === 'number' && options.numGpu > 0 ? 'gpu-offload' : 'cpu';
    for (const key of ['threads', 'numGpu'] as const) {
      const value = options[key] ?? (key === 'threads' ? 2 : 0);
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 128) fields[key] = value;
    }
  }
  logger.info('Выбран профиль NPC', fields);
  const entry = new URL('../game/index.ts', import.meta.url);
  try { await access(entry); }
  catch { throw new Error('Набор A не готов: отсутствует server/src/game/index.ts (createGame). Финальная интеграция TASK-026 выполняется после слияния A.'); }
  const { createGame } = await import(entry.href) as { createGame: CreateGame };
  const app = await startApplication(config, createGame, logger);
  shutdownOnSignals(app, logger);
} catch (error) {
  const profileErrors: Record<string, string> = {
    llm_profiles_invalid: 'Некорректный profiles.json: проверьте схему, пары backend/model и полный набор options',
    llm_profiles_unavailable: 'Каталог профилей недоступен. Для уже подготовленных моделей выполните make llm-import; существующий файл не удаляйте вслепую',
    llm_profile_selection_invalid: 'Некорректный выбор профиля: BACKEND и MODEL задаются вместе',
    llm_profile_not_found: 'Выбранная пара BACKEND/MODEL отсутствует в подготовленных профилях; автоматической подмены нет',
    llm_profile_unprepared: 'Файлы выбранного профиля недоступны или некорректны: проверьте runtime, model manifest и tokenizer inventory; автоматической загрузки нет',
    llm_profile_concurrency_invalid: 'Подготовленный LLM-профиль требует npc.maxConcurrent: 1',
    unsupported_platform: 'Выбранный backend несовместим с ОС/архитектурой. MLX требует macOS Apple Silicon; автоматической смены backend нет',
  };
  const code = error instanceof Error ? error.message : '';
  logger.error(profileErrors[code] ?? (code || 'Ошибка запуска')); process.exitCode = 1;
}
