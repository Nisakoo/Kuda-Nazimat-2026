import type { Logger } from '../common/logger.ts';
/** Process boundary: module shutdown is awaited, but a stuck adapter cannot hold the process indefinitely. */
export function shutdownOnSignals(app: { stop(): Promise<void> }, logger: Logger): void {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    logger.info('app.signal', 'Получен сигнал остановки');
    const deadline = setTimeout(() => { logger.fatal('app.stop.timeout', 'Остановка превысила 10 с'); process.exit(1); }, 10000);
    void app.stop().then(() => { clearTimeout(deadline); process.exitCode = 0; }, () => { logger.error('app.stop.failed', 'Ошибка остановки'); process.exit(1); });
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
