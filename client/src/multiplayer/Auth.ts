import { readBoundedJson } from './readBoundedJson';

export interface AuthMode { password: true; guest: boolean; dev: boolean }
export type AuthAction = 'login' | 'register' | 'password' | 'dev';
export class AuthError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export async function requestAuthMode(base: string, signal: AbortSignal): Promise<AuthMode> {
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/api/auth/mode`, { signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  } catch (error) {
    if (error instanceof TypeError) throw new Error('Не удалось связаться с сервером. Проверьте адрес и подключение к локальной сети.');
    throw error;
  }
  if (!response.ok) throw new Error('Не удалось получить способы входа.');
  const raw = await readBoundedJson(response);
  const mode = raw as Partial<AuthMode> | null;
  if (!mode || mode.password !== true || typeof mode.guest !== 'boolean' || typeof mode.dev !== 'boolean') throw new Error('Сервер вернул некорректные способы входа.');
  return { password: true, guest: mode.guest, dev: mode.dev };
}
