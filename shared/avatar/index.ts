export * from './types.ts';
export * from './validate.ts';
export function avatarAssetId(id: import('./types.ts').AvatarId): string { return `avatar-${id}`; }
