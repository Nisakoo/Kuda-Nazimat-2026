import { Group } from 'three';
import { DEMO_NPCS } from '../../shared/demo';
import type { SceneAssets, Shape } from './SceneAssets';

/** A stylized Babylonian courtyard, not a reconstruction of a specific monument. */
export function createDemoScenery(assets: SceneAssets): Group {
  const root = new Group();
  root.name = 'babylon-courtyard';
  function place(shape: Shape, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, brick = false) {
    const mesh = assets.mesh(shape, color, brick);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    root.add(mesh);
    return mesh;
  }
  const sand = '#d9b88b';
  const clay = '#c28d62';
  const lapis = '#456e91';
  const gold = '#e8c783';
  place('cylinder', '#c5b28c', 0, -0.5, 0, 27, 0.6, 27);
  place('roundedBox', '#c29d74', 0, -0.22, 0, 29, 0.34, 29);
  place('roundedBox', '#e7cf9f', 0, -0.05, 0, 27.6, 0.13, 27.6);
  place('roundedBox', '#f0ddb5', 0, 0.015, 3, 5, 0.04, 22);
  place('roundedBox', '#f0ddb5', 0, 0.025, 0, 23, 0.04, 3.2);

  // Stepped brick architecture with a small lapis shrine at the top.
  for (let level = 0; level < 4; level++) {
    place('roundedBox', level % 2 ? sand : clay, 0, 0.48 + level * 0.85, -8.5, 8.5 - level * 1.65, 0.9, 5.5 - level * 0.9, true);
    place('roundedBox', gold, 0, 0.91 + level * 0.85, -8.5, 8.6 - level * 1.65, 0.12, 5.6 - level * 0.9);
  }
  place('roundedBox', lapis, 0, 4.1, -8.5, 2.6, 1.4, 2.2, true);
  place('roundedBox', gold, 0, 4.85, -8.5, 2.9, 0.22, 2.5);
  for (let step = 0; step < 8; step++) {
    place('roundedBox', '#dfc398', 0, 0.09 + step * 0.15, -4.2 - step * 0.3, 1.7, 0.2, 0.38);
  }

  // Blue glazed towers and stepped parapets frame the far side of the courtyard.
  for (const side of [-1, 1]) {
    const x = side * 6.6;
    place('roundedBox', lapis, x, 2.7, -12, 2.5, 5.4, 2.4, true);
    place('roundedBox', '#7a9ca8', x, 5.4, -12, 2.8, 0.25, 2.7);
    for (const tooth of [-0.85, 0, 0.85]) place('roundedBox', lapis, x + tooth, 5.8, -12, 0.55, 0.7, 2.3, true);
    for (let row = 0; row < 3; row++) {
      const ornament = place('roundedBox', gold, x, 1.4 + row * 1.15, -10.77, 0.34, 0.34, 0.08);
      ornament.rotation.z = Math.PI / 4;
    }
    place('roundedBox', '#b99873', side * 10.6, 1.05, -12, 5.4, 2.1, 1.25, true);
    for (const z of [-7, -1, 5, 11]) place('roundedBox', '#bf9c74', side * 14.3, 0.55, z, 0.6, 1.1, 5.2, true);
  }

  for (const npc of DEMO_NPCS) {
    const x = npc.x * 1.95;
    const z = -1.8;
    place('roundedBox', '#ac8564', x, 0.16, z, 4.2, 0.32, 3.5);
    place('roundedBox', sand, x, 1.28, z - 0.45, 3.8, 2.25, 2.3, true);
    place('roundedBox', '#6c5644', x, 1.0, z + 0.72, 0.92, 1.65, 0.06);
    place('roundedBox', clay, x, 2.55, z - 0.35, 4.2, 0.35, 2.8);
    for (const side of [-1, 1]) {
      place('roundedBox', '#ded0a6', x + side * 1.25, 1.5, z + 0.73, 0.6, 0.65, 0.06);
      place('roundedBox', lapis, x + side * 1.25, 1.5, z + 0.78, 0.4, 0.45, 0.04);
      place('cylinder', '#8c7156', x + side * 1.65, 1.3, z + 1.7, 0.065, 2.6, 0.065);
    }
    place('roundedBox', npc.id === 'history-guide' ? '#b77652' : '#698f9d', x, 2.5, z + 1.1, 4, 0.13, 2.1);
    const sign = assets.label(npc.id === 'history-guide' ? 'ДОМ ПИСЦА' : 'ДОМ ЗНАНИЙ', '#68513e');
    sign.position.set(x, 3.15, z);
    root.add(sign);
  }

  const palms = [[-12, -9], [12, -9], [-12, 1], [12, 1], [-11, 10], [11, 10]];
  palms.forEach(([x = 0, z = 0], index) => {
    place('cylinder', '#9c7852', x, 1.3, z, 0.2, 2.6, 0.2);
    for (let ring = 0; ring < 5; ring++) place('cylinder', '#b38b61', x, 0.4 + ring * 0.44, z, 0.23, 0.09, 0.23);
    place('sphere', '#739c75', x, 2.7, z, 0.45, 0.3, 0.45);
    for (let leaf = 0; leaf < 7; leaf++) {
      const angle = leaf * Math.PI * 2 / 7 + index;
      const frond = place('sphere', leaf % 2 ? '#6b9574' : '#88a67b', x + Math.sin(angle) * 0.8, 2.75, z + Math.cos(angle) * 0.8, 0.35, 0.13, 1.6);
      frond.rotation.y = angle;
      frond.rotation.x = 0.15;
    }
  });

  for (const x of [-3, 3]) for (const z of [4, 8]) {
    place('cylinder', '#b68159', x, 0.35, z, 0.38, 0.65, 0.38);
    place('cylinder', gold, x, 0.69, z, 0.41, 0.1, 0.41);
    place('sphere', '#7e9e77', x, 0.9, z, 0.46, 0.42, 0.46);
  }
  for (const x of [-8, 8]) {
    place('roundedBox', '#bb9669', x, 0.32, 6.5, 2.3, 0.6, 0.9);
    place('roundedBox', '#d8be8c', x, 0.65, 6.5, 2.45, 0.14, 1.05);
  }
  for (const side of [-1, 1]) {
    place('roundedBox', '#c29d74', side * 10, 0.45, 14.2, 8, 0.9, 0.6, true);
    place('roundedBox', '#b38a62', side * 3.6, 0.8, 11.5, 0.9, 1.6, 0.9, true);
    place('sphere', '#e5c48d', side * 3.6, 1.75, 11.5, 0.55, 0.25, 0.55);
  }
  return root;
}
