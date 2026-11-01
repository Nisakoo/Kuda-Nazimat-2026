import type { CreateGame } from '../contracts.ts';
import { consoleLogger } from '../common/logger.ts';
import { createGame } from '../game/index.ts';
import { shutdownOnSignals } from './shutdown.ts';
import { startApplication } from './application.ts';
import { loadConfig, serverArguments } from './config.ts';
import { connectionBlock, connectionInfo, lanAddresses } from '../common/network.ts';
const logger = consoleLogger();
try {
  const args = serverArguments();
  const loaded = await loadConfig(args.configPath);
  const config = args.port === undefined ? loaded : { ...loaded, port: args.port };
  const app = await startApplication(config, createGame satisfies CreateGame, logger);
  const address = app.server.address();
  const port = address && typeof address !== 'string' ? address.port : config.port;
  process.stdout.write(`${connectionBlock(connectionInfo(config.host, port, lanAddresses()))}\n`);
  shutdownOnSignals(app, logger);
} catch (error) { logger.error(error instanceof Error ? error.message : 'Ошибка запуска'); process.exitCode = 1; }
