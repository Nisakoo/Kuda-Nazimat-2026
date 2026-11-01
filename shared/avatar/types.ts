export const AVATAR_IDS = ['lukas', 'nic', 'dan', 'ksu'] as const;
export type AvatarId = typeof AVATAR_IDS[number];
export interface AvatarState { readonly avatarId: AvatarId | null }
