import { parseConfig } from './config';
import type { ClientConfig } from './config';

const key = 'babylon.serverUrl';
/** Only a public server address is persisted. Authentication stays in memory. */
export function restoreConnection(config: ClientConfig, storage: Pick<Storage, 'getItem'>, origin: string): ClientConfig {
  try {
    const address = storage.getItem(key);
    return address ? parseConfig({ ...config, serverUrl: address }, origin) : config;
  } catch { return config; }
}
export function rememberConnection(address: string, storage: Pick<Storage, 'setItem'>): boolean {
  try { storage.setItem(key, address); return true; } catch { return false; }
}
