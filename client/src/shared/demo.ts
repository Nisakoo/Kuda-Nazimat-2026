/** Tiny local fixtures; these are not chunk/region parameters for the real world. */
export const DEMO_BOUNDS = { minX: -14, maxX: 14, minZ: -14, maxZ: 14 } as const;
export const DEMO_SPAWN = { x: 0, y: 0, z: 6 } as const;
export const DEMO_NPCS = [
  { id: 'history-guide', name: 'Лея', topic: 'История', x: -4, z: 0, color: '#d88752' },
  { id: 'science-guide', name: 'Марк', topic: 'Наука', x: 4, z: 0, color: '#698ec1' },
] as const;
