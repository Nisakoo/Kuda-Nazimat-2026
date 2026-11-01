import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AnimationMixer, Box3, CylinderGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { configureAvatarCamera, placeAvatarPreview } from './ThreeAvatarPreview';

const ids = ['lukas', 'nic', 'dan', 'ksu'] as const;
const modelsDir = process.env.AVATAR_PREVIEW_MODELS_DIR;
const file = (id: string) => modelsDir ? pathToFileURL(join(modelsDir, `${id}.glb`)) : new URL(`../../../public/assets/models/avatars/${id}.glb`, import.meta.url);

describe('avatar preview camera framing', () => {
  it('fits every GLB and the full pedestal with margin at eight yaw angles and throughout sampled idle', async () => {
    const pedestal = new Mesh(new CylinderGeometry(.72, .76, .12, 6), new MeshBasicMaterial()); pedestal.position.y = -.065; pedestal.updateMatrixWorld(true);
    const cameras = [.5, .72, 1, 1.6].map(aspect => { const camera = new OrthographicCamera(-1, 1, 1.1, -1.1, .1, 30); configureAvatarCamera(camera, aspect * 1000, 1000); camera.updateMatrixWorld(true); return camera; });
    const worst = { x: 0, y: 0, z: 0 };
    const worstPoint: Record<string, unknown> = {};
    let context = 'pedestal';
    const point = new Vector3(), projected = new Vector3();
    function checkMesh(mesh: Mesh) {
      const positions = mesh.geometry.attributes.position;
      if (!positions) throw new Error('The preview mesh has no positions.');
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        for (const camera of cameras) {
          const p = projected.copy(point).project(camera);
          for (const axis of ['x', 'y', 'z'] as const) if (Math.abs(p[axis]) > worst[axis]) {
            worst[axis] = Math.abs(p[axis]); worstPoint[axis] = { context, mesh: mesh.name, vertex: i, coordinate: p[axis], aspect: (camera.right - camera.left) / (camera.top - camera.bottom) };
          }
        }
      }
    }
    checkMesh(pedestal);
    for (const id of ids) {
      const bytes = await readFile(file(id));
      const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
      const model = gltf.scene, group = new Group();
      const bounds = new Box3().setFromObject(model), height = bounds.getSize(new Vector3()).y;
      expect(height).toBeGreaterThan(0);
      placeAvatarPreview(model); group.add(model);
      expect(new Box3().setFromObject(model).getSize(new Vector3()).y).toBeCloseTo((id === 'lukas' ? 1.95 : 1.8) * 1.85 / 1.8, 5);
      const mixer = new AnimationMixer(model), idle = gltf.animations.find(clip => clip.name === 'idle');
      expect(idle).toBeDefined(); mixer.clipAction(idle!).play();
      for (let angle = 0; angle < 8; angle++) {
        const yaw = angle * Math.PI / 4; group.rotation.y = yaw;
        for (let sample = 0; sample < 16; sample++) {
          context = `${id}, yaw ${angle * 45}, idle sample ${sample}`;
          mixer.setTime(idle!.duration * sample / 16); group.updateMatrixWorld(true);
          model.traverse(object => { if ((object as Mesh).isMesh) checkMesh(object as Mesh); });
        }
      }
      mixer.stopAllAction(); mixer.uncacheRoot(model);
    }
    console.log('preview projected maximum absolute NDC', worst, worstPoint);
    expect(worst.x).toBeLessThanOrEqual(.98); expect(worst.y).toBeLessThanOrEqual(.98); expect(worst.z).toBeLessThanOrEqual(.98);
    pedestal.geometry.dispose(); pedestal.material.dispose();
  }, 30000);
});
