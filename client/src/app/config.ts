export interface ClientConfig {
  readonly session: 'local' | 'online';
  readonly serverUrl: string;
  readonly mapId: string;
  // null selects the map's default radius (two for market, one for demo/science).
  readonly chunkRadius: number | null;
  readonly debug: boolean;
}

const keys = new Set(['session', 'serverUrl', 'mapId', 'chunkRadius', 'debug']);

export function parseConfig(raw: unknown, origin: string): ClientConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Настройки клиента должны быть JSON-объектом.');
  }
  const values = raw as Record<string, unknown>;
  if (Object.keys(values).some((key) => !keys.has(key))) {
    throw new Error('В настройках клиента есть неизвестные параметры.');
  }
  const session = values.session === undefined ? 'local' : values.session;
  if (session !== 'local' && session !== 'online') {
    throw new Error('Неизвестный режим сессии.');
  }
  const mapId = values.mapId === undefined ? 'demo' : values.mapId;
  if (typeof mapId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(mapId)) {
    throw new Error('Некорректный идентификатор карты.');
  }
  const chunkRadius = values.chunkRadius ?? null;
  if (chunkRadius !== null &&
      (typeof chunkRadius !== 'number' || !Number.isSafeInteger(chunkRadius) || chunkRadius < 0 || chunkRadius > 2)) {
    throw new Error('Радиус чанков должен быть целым числом от 0 до 2 или null.');
  }
  const debug = values.debug === undefined ? false : values.debug;
  if (typeof debug !== 'boolean') {
    throw new Error('Параметр debug должен быть логическим значением.');
  }
  const address = values.serverUrl;
  if (address !== undefined && address !== null &&
      (typeof address !== 'string' || address.trim() === '')) {
    throw new Error('Некорректный адрес сервера.');
  }
  const url = new URL(address ?? origin, origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Укажите HTTP-адрес сервера без учётных данных, query и fragment.');
  }
  return Object.freeze({
    session, serverUrl: url.href.replace(/\/$/, ''), mapId, chunkRadius, debug,
  });
}
