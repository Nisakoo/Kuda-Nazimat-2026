import { Group } from 'three';
import { DEMO_NPCS } from '../../shared/demo';
import type { SceneAssets, Shape } from './SceneAssets';

export function createDemoScenery(assets: SceneAssets): Group {
  const root = new Group();
  root.name = 'demo-plaza';
  function place(shape: Shape, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const mesh = assets.mesh(shape, color);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    root.add(mesh);
    return mesh;
  }
  place('cylinder', '#8eaf8d', 0, -0.46, 0, 25, 0.65, 25);
  place('cylinder', '#d4ccb5', 0, -0.17, 0, 11.3, 0.2, 11.3);
  place('cylinder', '#e9dfc9', 0, -0.06, 0, 10.8, 0.12, 10.8);
  place('box', '#e9dfc9', 0, -0.04, 0, 5, 0.1, 28);
  place('box', '#e9dfc9', 0, -0.03, 0, 28, 0.1, 4);
  place('cylinder', '#b4c5bf', 0, 0.24, -3.6, 1.45, 0.5, 1.45);
  place('cylinder', '#eff3e9', 0, 0.55, -3.6, 1.2, 0.18, 1.2);
  place('sphere', '#69b5af', 0, 1.35, -3.6, 0.65, 0.65, 0.65);
  for (const npc of DEMO_NPCS) {
    const x = npc.x * 1.7;
    const z = -5.8;
    place('box', '#d5c6ad', x, 0.2, z, 4.1, 0.35, 3);
    place('box', '#f7f2e5', x, 1.35, z - 0.6, 3.6, 2.3, 1.7);
    place('box', npc.color, x, 2.8, z - 0.1, 4, 0.35, 2.8);
    for (const side of [-1, 1]) {
      place('cylinder', '#faf5e6', x + side * 1.65, 1.45, z + 1, 0.12, 2.6, 0.12);
      place('box', '#829c9d', x + side * 0.85, 1.65, z + 0.27, 0.8, 0.95, 0.06);
    }
    const sign = assets.label(npc.topic.toUpperCase());
    sign.position.set(x, 3.35, z);
    root.add(sign);
  }
  const trees = [[-11, -9], [-12, -3], [-12, 4], [-10, 10], [-6, 12], [11, -9], [12, -3], [12, 4], [10, 10], [6, 12], [-3, -12], [3, -12]];
  trees.forEach(([x = 0, z = 0], index) => {
    place('cylinder', '#8a7154', x, 0.8, z, 0.17, 1.6, 0.17);
    place('sphere', index % 2 ? '#578e75' : '#6f9e76', x, 2.2, z, 1.15, 1.45, 1.15);
    place('sphere', '#87ac80', x + 0.35, 2.75, z - 0.1, 0.8, 0.9, 0.8);
  });
  for (const x of [-7, 7]) for (const z of [4, 8]) {
    place('box', '#b78d64', x, 0.55, z, 2.2, 0.16, 0.7);
    place('box', '#c69d72', x, 0.95, z - 0.35, 2.2, 0.65, 0.12);
    for (const side of [-1, 1]) place('box', '#627571', x + side * 0.8, 0.26, z, 0.14, 0.5, 0.5);
  }
  for (const side of [-1, 1]) for (let index = -3; index <= 3; index++) {
    if (index === 0) continue;
    place('box', '#6f9677', side * 14.6, 0.4, index * 4, 0.6, 0.8, 3.6);
    place('box', '#6f9677', index * 4, 0.4, side * 14.6, 3.6, 0.8, 0.6);
  }
  for (const x of [-2.6, 2.6]) {
    place('cylinder', '#71817b', x, 1.7, 11, 0.08, 3.4, 0.08);
    place('sphere', '#fcdf97', x, 3.45, 11, 0.3, 0.38, 0.3);
  }
  return root;
}
