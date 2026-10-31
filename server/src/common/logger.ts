/** Structured log port. Callers pass IDs, codes and durations only — never tokens or message texts. */
export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(module: string): Logger;
}

export function consoleLogger(module = 'app', write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  const log = (level: string) => (message: string, fields?: Record<string, unknown>) =>
    write(`${new Date().toISOString()} ${level} [${module}] ${message}${fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : ''}`);
  return { info: log('INFO'), warn: log('WARN'), error: log('ERROR'), child: (name) => consoleLogger(name, write) };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {}, child: () => silentLogger };
