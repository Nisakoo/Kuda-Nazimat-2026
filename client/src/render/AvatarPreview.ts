import type { AvatarId } from '../../../shared/avatar/types';

/** UI preview is presentation only. It cannot change the player's saved appearance. */
export interface AvatarPreview {
  select(id: AvatarId): void;
  rotate(radians: number): void;
  dispose(): void;
}
export interface AvatarPreviewEvents {
  loaded(): void;
  portrait(id: AvatarId, url: string): void;
  error(message: string): void;
}
