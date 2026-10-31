import { access } from 'node:fs/promises';
import type { CreateGame } from '../contracts.ts';
import { consoleLogger } from '../common/logger.ts';
import { shutdownOnSignals } from './shutdown.ts';
import { startApplication } from './application.ts';
import { configArgument, loadConfig } from './config.ts';
const logger = consoleLogger();
try {
  const config = await loadConfig(configArgument());
  const entry = new URL('../game/index.ts', import.meta.url);
  try { await access(entry); }
  catch { throw new Error('Набор A не готов: отсутствует server/src/game/index.ts (createGame). Финальная интеграция TASK-026 выполняется после слияния A.'); }
  const { createGame } = await import(entry.href) as { createGame: CreateGame };
  const app = await startApplication(config, createGame, logger);
  shutdownOnSignals(app, logger);
} catch (error) { logger.error(error instanceof Error ? error.message : 'Ошибка запуска'); process.exitCode = 1; }
