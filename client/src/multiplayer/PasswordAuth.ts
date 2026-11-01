import type { ServerSession } from '../../../shared/protocol/types';
import { parseServerSession } from '../../../shared/protocol/validate';
import { guestName } from './GuestAuth';
import { readBoundedJson as json } from './readBoundedJson';

const registrationRecovery = ' Аккаунт мог быть создан. Попробуйте войти по имени и паролю, а не регистрироваться повторно.';
function boundedReadError(error: unknown): string | null {
  // Never expose transport errors, server payloads, credentials, or token values.
  const message = error instanceof Error ? error.message : '';
  return ['Сервер вернул пустой ответ.', 'Ответ сервера превышает допустимый размер.', 'Сервер вернул некорректный ответ.'].includes(message) ? message : null;
}
function authFailure(raw: unknown, status: number): string {
  const code = (raw as { error?: { code?: unknown } } | null)?.error?.code;
  if (code === 'FULL') return 'Сервер заполнен: в мире уже 4 игрока.';
  if (code === 'RATE_LIMIT' || status === 429) return 'Слишком частые попытки. Повторите позже.';
  if (code === 'NAME_TAKEN' || status === 409) return 'Имя уже занято.';
  if (code === 'INVALID_CREDENTIALS' || status === 401) return 'Неверное имя или пароль.';
  if (code === 'INVALID') return 'Проверьте имя и пароль.';
  return 'Не удалось войти. Проверьте подключение и повторите попытку.';
}
export async function requestPasswordSession(serverUrl: string, mode: 'login' | 'register', rawName: string, password: string, signal: AbortSignal): Promise<{ session: ServerSession; requiresAvatar: boolean }> {
  const name = guestName(rawName);
  if (!password || password.length > 128) throw new Error('Введите пароль длиной до 128 символов.');
  const recovery = mode === 'register' ? registrationRecovery : '';
  let response: Response;
  try {
    signal.throwIfAborted();
    response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }), cache: 'no-store', credentials: 'omit', redirect: 'error', signal });
  } catch { throw new Error('Сервер недоступен. Проверьте подключение и повторите попытку.' + recovery); }
  if (response.status === 404 || response.status === 405) throw new Error(mode === 'register' ? 'Этот сервер не поддерживает регистрацию. Аккаунт не создан.' : 'Этот сервер не поддерживает вход по паролю. Гостевой вход выполняется отдельно.');
  let raw: unknown;
  try { raw = await json(response); }
  catch (error) { throw new Error((boundedReadError(error) ?? 'Не удалось прочитать ответ сервера.') + recovery); }
  if (!response.ok) throw new Error(authFailure(raw, response.status) + recovery);
  let session: ServerSession;
  try { session = parseServerSession(raw, Date.now()); }
  catch { throw new Error('Сервер вернул недействительную сессию. Повторите вход.' + recovery); }
  try {
    // A cancelled fetch can still yield a late valid response in an adapter or a race.
    // Keep its token until this guard can revoke it instead of silently discarding it.
    signal.throwIfAborted();
    const stateResponse = await fetch(`${serverUrl.replace(/\/$/, '')}/api/auth/state`, { headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal });
    const state = await json(stateResponse) as Record<string, unknown>;
    signal.throwIfAborted();
    if (!stateResponse.ok || !state || Array.isArray(state) || Object.keys(state).length !== 1 || typeof state.requiresAvatar !== 'boolean') throw new Error('Invalid account state');
    return { session, requiresAvatar: state.requiresAvatar };
  } catch (error) {
    // Cleanup has its own signal and deadline. Do not add its 10-second timeout to entry UI.
    void revokeSession(serverUrl, session.token).catch(() => {});
    const detail = boundedReadError(error);
    throw new Error((detail ? detail + ' ' : '') + 'Не удалось проверить состояние аккаунта. Повторите вход.' + recovery);
  }
}
export async function revokeSession(serverUrl: string, token: string): Promise<void> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal });
    if (!response.ok && response.status !== 401) throw new Error('Не удалось подтвердить выход на сервере.');
  } finally { clearTimeout(timer); }
}
