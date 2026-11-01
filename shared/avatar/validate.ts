import { AVATAR_IDS, type AvatarId, type AvatarState } from './types.ts';

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && (AVATAR_IDS as readonly string[]).includes(value);
}
function field(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'avatarId')) throw new Error('Invalid avatar state');
  return (value as Record<string, unknown>).avatarId;
}
export function parseAvatarState(value: unknown): AvatarState {
  const avatarId = field(value);
  if (avatarId !== null && !isAvatarId(avatarId)) throw new Error('Invalid avatar ID');
  return { avatarId };
}
export function parseAvatarSelection(value: unknown): { avatarId: AvatarId } {
  const avatarId = field(value);
  if (!isAvatarId(avatarId)) throw new Error('Invalid avatar ID');
  return { avatarId };
}
