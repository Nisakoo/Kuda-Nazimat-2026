import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { SceneAssets } from '../src/render/three/SceneAssets';
import { createDemoScenery } from '../src/render/three/demoScenery';
import { Group } from 'three';
declare global { interface Window { exportDemoScene(): Promise<number[]>; exportDistrict(kind: string): Promise<number[]> } }
window.exportDemoScene = async () => {
  const assets = new SceneAssets();
  const scene = createDemoScenery(assets);
  const labels = scene.children.filter((child) => child.type === 'Sprite');
  for (const label of labels) scene.remove(label);
  try {
    const data = await new GLTFExporter().parseAsync(scene, { binary: true });
    if (!(data instanceof ArrayBuffer)) throw new Error('Expected GLB');
    return [...new Uint8Array(data)];
  } finally { assets.dispose(); }
};
window.exportDistrict = async (kind) => {
  const assets = new SceneAssets();
  const root = new Group();
  const place = (shape: 'roundedBox' | 'cylinder' | 'sphere', color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, brick = false) => {
    const mesh = assets.mesh(shape, color, brick); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); root.add(mesh);
  };
  place('roundedBox', '#ddc695', 0, -0.07, 0, 32, 0.14, 32);
  place('roundedBox', '#f0ddb5', 0, 0.01, 0, 5, 0.04, 32);
  place('roundedBox', '#f0ddb5', 0, 0.02, 0, 32, 0.04, 5);
  for (const side of [-1, 1]) {
    place('roundedBox', '#c49b6d', side * 10, 1.1, -8, 5, 2.2, 4, true);
    place('roundedBox', kind === 'history' ? '#b67e57' : '#537f98', side * 10, 2.3, -8, 5.4, 0.3, 4.4);
    place('roundedBox', '#68513e', side * 10, 0.9, -5.95, 0.8, 1.8, 0.05);
    place('cylinder', '#95754e', side * 9, 1.2, 9, 0.2, 2.4, 0.2);
    for (let leaf = 0; leaf < 5; leaf++) {
      const angle = leaf * Math.PI * 2 / 5;
      const mesh = assets.mesh('sphere', '#83a178'); mesh.position.set(side * 9 + Math.sin(angle) * 0.7, 2.4, 9 + Math.cos(angle) * 0.7); mesh.scale.set(0.35, 0.12, 1.4); mesh.rotation.y = angle; root.add(mesh);
    }
  }
  try { const data = await new GLTFExporter().parseAsync(root, { binary: true }); if (!(data instanceof ArrayBuffer)) throw new Error('Expected GLB'); return [...new Uint8Array(data)]; }
  finally { assets.dispose(); }
};
