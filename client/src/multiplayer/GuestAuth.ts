import type { ServerSession } from '../../../shared/protocol/types.ts';
import { parseServerSession } from '../../../shared/protocol/validate.ts';

export function guestName(raw: string): string {
  const name = raw.trim();
  if (!name || name.length > 32 || /[\x00-\x1f\x7f-\x9f]/.test(raw)) throw new Error('Введите имя длиной 1–32 символа без управляющих символов.');
  return name;
}
/** HTTP adapter; GameApp owns cancellation, deadline and the resulting in-memory session. */
export async function requestGuestSession(serverUrl: string, rawName: string, signal: AbortSignal): Promise<ServerSession> {
  const name = guestName(rawName);
  let response: Response;
  try {
    response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/auth/guest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      cache: 'no-store', credentials: 'omit', redirect: 'error', signal,
    });
  } catch { throw new Error('Не удалось связаться с сервером. Проверьте адрес и подключение к локальной сети.'); }
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('Сервер вернул некорректный ответ. Попробуйте войти снова.'); }
  if (!response.ok) {
    const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
    throw new Error(typeof message === 'string' && message.trim() ? message.slice(0, 500) : 'Не удалось войти. Попробуйте снова.');
  }
  try { return parseServerSession(body, Date.now()); }
  catch { throw new Error('Сервер вернул недействительную сессию. Попробуйте войти снова.'); }
}
