/** Connection form accepts IP literals only, never credentials, paths or script URLs. */
export function serverAddress(ip: string, port: string, protocol = 'http:'): string {
  const host = ip.trim().replace(/^\[|\]$/g, '');
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Укажите порт от 1 до 65535.');
  const ipv4 = host.split('.');
  const v4 = ipv4.length === 4 && ipv4.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  if (!v4 && !/^[0-9a-f:]+$/i.test(host)) throw new Error('Укажите IP-адрес сервера.');
  try {
    const address = new URL(`${protocol === 'https:' ? 'https:' : 'http:'}//${v4 ? ipv4.map(Number).join('.') : `[${host}]`}:${Number(port)}`);
    return address.origin;
  } catch { throw new Error('Укажите корректный IP-адрес сервера.'); }
}
