import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, BoxGeometry } from 'three';
import type { Material, WebGLProgramParametersWithUniforms } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { layerAvatarClothing, TROUSER_DEPTH_BIAS } from './avatarClothLayering';

const load = async (id: string) => {
  const bytes = await readFile(new URL(`../../../public/assets/models/avatars/${id}.glb`, import.meta.url));
  return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
};
const compiled = (material: Material) => {
  const shader = { vertexShader: '#include <project_vertex>\n', fragmentShader: '', uniforms: {} } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, undefined as never);
  return shader.vertexShader;
};

describe('avatar cloth layering', () => {
  it.each(['lukas', 'nic', 'dan', 'ksu'])('biases only the trouser surfaces of %s', async id => {
    const scene = await load(id);
    const before = new Map<string, Material>();
    scene.traverse(node => { if (node instanceof Mesh) before.set(node.name, node.material as Material); });
    expect(layerAvatarClothing(scene)).toBe(4);
    scene.traverse(node => {
      if (!(node instanceof Mesh)) return;
      const trousers = /^(hip|knee)-(left|right)-surface$/.test(node.name);
      expect(node.material !== before.get(node.name)).toBe(trousers);
      if (trousers) {
        expect(compiled(node.material as Material)).toContain(`vec3( 0.0, 0.0, ${TROUSER_DEPTH_BIAS.toFixed(3)} )`);
        expect((node.material as Material).customProgramCacheKey()).toBe('avatar-trouser-depth-bias');
      }
    });
  });

  it('shares one layered material per source material and ignores non-avatar models', () => {
    const shared = new MeshStandardMaterial(), avatar = new Group(), other = new Group();
    avatar.name = 'avatar'; avatar.userData.avatarId = 'ksu';
    for (const name of ['hip-left-surface', 'knee-right-surface', 'ankle-left-surface']) { const mesh = new Mesh(new BoxGeometry(), shared); mesh.name = name; avatar.add(mesh); }
    expect(layerAvatarClothing(avatar)).toBe(2);
    const [hip, knee, ankle] = avatar.children as Mesh[];
    expect(hip!.material).toBe(knee!.material); expect(hip!.material).not.toBe(shared); expect(ankle!.material).toBe(shared);
    const mesh = new Mesh(new BoxGeometry(), shared); mesh.name = 'hip-left-surface'; other.add(mesh);
    expect(layerAvatarClothing(other)).toBe(0);
  });
});
