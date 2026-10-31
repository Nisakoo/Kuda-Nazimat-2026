import { BoxGeometry, CapsuleGeometry, CircleGeometry, CylinderGeometry, SphereGeometry, Mesh, MeshStandardMaterial, CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BufferGeometry, Material, Object3D } from 'three';
import { ResourcePool } from './ResourcePool';

export type Shape = 'box' | 'roundedBox' | 'sphere' | 'cylinder' | 'circle' | 'capsule';

export class SceneAssets {
  private readonly geometry = new ResourcePool<BufferGeometry>();
  private readonly materials = new ResourcePool<Material>();
  private readonly textures = new ResourcePool<CanvasTexture>();
  private readonly releases = new WeakMap<Object3D, () => void>();

  mesh(shape: Shape, color: string, brick = false): Mesh {
    const geometry = this.geometry.acquire(shape, () => {
      switch (shape) {
        case 'box': return new BoxGeometry(1, 1, 1);
        case 'roundedBox': return new RoundedBoxGeometry(1, 1, 1, 2, 0.08);
        case 'sphere': return new SphereGeometry(1, 16, 12);
        case 'cylinder': return new CylinderGeometry(1, 1, 1, 16);
        case 'circle': return new CircleGeometry(1, 32);
        case 'capsule': return new CapsuleGeometry(0.3, 0.55, 8, 12);
      }
    });
    const key = brick ? `brick:${color}` : color;
    const map = brick ? this.textures.acquire(key, () => this.brickTexture(color)) : null;
    const material = this.materials.acquire(key, () => new MeshStandardMaterial({ color: map ? '#ffffff' : color, map, roughness: 0.9 }));
    const mesh = new Mesh(geometry, material);
    this.releases.set(mesh, () => { this.geometry.release(shape); this.materials.release(key); if (brick) this.textures.release(key); });
    return mesh;
  }

  label(text: string, color = '#243b43'): Sprite {
    const key = `label:${text}:${color}`;
    const texture = this.textures.acquire(key, () => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 112;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Не удалось создать подпись персонажа.');
      context.fillStyle = '#fffffff0';
      context.beginPath();
      context.roundRect(5, 5, 502, 102, 28);
      context.fill();
      context.fillStyle = color;
      context.font = '600 36px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, 256, 56, 470);
      const result = new CanvasTexture(canvas);
      result.colorSpace = SRGBColorSpace;
      return result;
    });
    const material = this.materials.acquire(key, () => new SpriteMaterial({ map: texture, depthTest: false, transparent: true })) as SpriteMaterial;
    const sprite = new Sprite(material);
    sprite.scale.set(2.8, 0.61, 1);
    sprite.renderOrder = 10;
    this.releases.set(sprite, () => { this.materials.release(key); this.textures.release(key); });
    return sprite;
  }

  release(root: Object3D): void {
    root.traverse((object) => { this.releases.get(object)?.(); this.releases.delete(object); });
    root.removeFromParent();
  }

  dispose(): void { this.materials.dispose(); this.textures.dispose(); this.geometry.dispose(); }

  private brickTexture(color: string): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить оформление сцены.');
    context.fillStyle = '#e6d3a9';
    context.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 8; row++) for (let column = -1; column < 9; column++) {
      const x = column * 64 + (row % 2) * 32;
      const y = row * 32;
      context.fillStyle = color;
      context.fillRect(x + 1, y + 1, 62, 30);
      context.fillStyle = (row + column) % 3 === 0 ? '#ffffff12' : '#593f2410';
      context.fillRect(x + 1, y + 1, 62, 30);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }
}
