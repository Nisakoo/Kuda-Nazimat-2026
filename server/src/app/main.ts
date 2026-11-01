import { createGame } from '../game/index.ts';
import { consoleSink } from '../obs/sinks.ts';
import { createObservability, installProcessHooks } from '../obs/index.ts';
import { createLogger } from '../common/logger.ts';
import { connectionBlock, connectionInfo, lanAddresses } from '../common/network.ts';
import { shutdownOnSignals } from './shutdown.ts';
import { startApplication } from './application.ts';
import { loadServerConfig } from './config.ts';

let config;
try { config = (await loadServerConfig()).config; }
catch (error) {
  // No configuration yet, so no file log: report to the console and exit (OBS-003 config.invalid).
  createLogger(consoleSink('info'), 'config').fatal('config.invalid', error instanceof Error ? error.message : 'Неверная конфигурация');
  process.exit(1);
}
const obs = createObservability(config.logs);
installProcessHooks(obs);
try {
  const app = await startApplication(config, createGame, obs.logger, undefined, obs);
  const address = app.server.address();
  const port = address && typeof address !== 'string' ? address.port : config.port;
  process.stdout.write(`${connectionBlock(connectionInfo(config.host, port, lanAddresses()))}\n`);
  shutdownOnSignals({ stop: async () => { try { await app.stop(); } finally { obs.close(); } } }, obs.logger);
} catch (error) {
  obs.logger.fatal('app.start.failed', error instanceof Error ? error.message : 'Ошибка запуска', { error });
  obs.close();
  process.exitCode = 1;
}
