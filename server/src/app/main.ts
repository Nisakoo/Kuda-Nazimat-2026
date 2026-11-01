import { createGame } from '../game/index.ts';
import { consoleSink } from '../obs/sinks.ts';
import { createObservability, installProcessHooks } from '../obs/index.ts';
import { createLogger } from '../common/logger.ts';
import { connectionBlock, connectionInfo, lanAddresses } from '../common/network.ts';
import { shutdownOnSignals } from './shutdown.ts';
import { startApplication } from './application.ts';
import { loadLaunchConfig } from './launch.ts';
import { daysLeft, EXPIRY_WARNING_DAYS } from '../tls/store.ts';

const profileErrors: Record<string, string> = {
  llm_profiles_invalid: 'Некорректный profiles.json: проверьте схему, пары backend/model и полный набор options',
  llm_profiles_unavailable: 'Каталог профилей недоступен. Для уже подготовленных моделей выполните make llm-import; существующий файл не удаляйте вслепую',
  llm_profile_selection_invalid: 'Некорректный выбор профиля: BACKEND и MODEL задаются вместе',
  llm_profile_not_found: 'Выбранная пара BACKEND/MODEL отсутствует в подготовленных профилях; автоматической подмены нет',
  llm_profile_unprepared: 'Файлы выбранного профиля недоступны или некорректны: проверьте runtime, model manifest и tokenizer inventory; автоматической загрузки нет',
  llm_profile_concurrency_invalid: 'Подготовленный LLM-профиль требует npc.maxConcurrent: 1',
  unsupported_platform: 'Выбранный backend несовместим с ОС/архитектурой. MLX требует macOS Apple Silicon; автоматической смены backend нет',
};
function launchMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return profileErrors[code] ?? (code || 'Ошибка запуска');
}

let config;
let profile;
try { ({ config, profile } = await loadLaunchConfig()); }
catch (error) {
  // No configuration yet, so no file log: report to the console and exit (OBS-003 config.invalid).
  createLogger(consoleSink('info'), 'config').fatal('config.invalid', launchMessage(error));
  process.exit(1);
}
const obs = createObservability(config.logs);
installProcessHooks(obs);
try {
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
  obs.logger.info('npc.profile.selected', 'Выбран профиль NPC', fields);
  const app = await startApplication(config, createGame, obs.logger, undefined, obs);
  const address = app.server.address();
  const port = address && typeof address !== 'string' ? address.port : config.port;
  const info = connectionInfo(config.host, port, lanAddresses());
  const { certificate } = app;
  const warnings = [...info.warnings, ...(certificate.created ? ['Создан новый сертификат: каждое устройство должно один раз его установить (страница /setup).'] : []),
    ...(certificate.uncovered.length ? [`Сертификат не покрывает адреса ${certificate.uncovered.join(', ')}: по ним игроки увидят ошибку. Выпустите новый: npm --prefix server run tls -- renew --yes`] : []),
    ...(daysLeft(certificate.info, new Date()) < EXPIRY_WARNING_DAYS ? ['Сертификат скоро истечёт: npm --prefix server run tls -- renew --yes'] : [])];
  process.stdout.write(`${connectionBlock({ ...info, warnings }, { fingerprint: certificate.info.fingerprint, notAfter: certificate.info.notAfter })}\n`);
  shutdownOnSignals({ stop: async () => { try { await app.stop(); } finally { obs.close(); } } }, obs.logger);
} catch (error) {
  obs.logger.fatal('app.start.failed', error instanceof Error ? error.message : 'Ошибка запуска', { error });
  obs.close();
  process.exitCode = 1;
}
