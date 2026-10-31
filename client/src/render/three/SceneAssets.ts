import { BoxGeometry, CapsuleGeometry, CircleGeometry, CylinderGeometry, SphereGeometry, Mesh, MeshStandardMaterial, CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import { ResourcePool } from './ResourcePool';

export type Shape = 'box' | 'sphere' | 'cylinder' | 'circle' | 'capsule';

export class SceneAssets {
  private readonly geometry = new ResourcePool<BufferGeometry>();
  private readonly materials = new ResourcePool<Material>();
  private readonly textures = new ResourcePool<CanvasTexture>();
  private readonly releases = new WeakMap<Object3D, () => void>();

  mesh(shape: Shape, color: string): Mesh {
    const geometry = this.geometry.acquire(shape, () => {
      switch (shape) {
        case 'box': return new BoxGeometry(1, 1, 1);
        case 'sphere': return new SphereGeometry(1, 10, 8);
        case 'cylinder': return new CylinderGeometry(1, 1, 1, 16);
        case 'circle': return new CircleGeometry(1, 32);
        case 'capsule': return new CapsuleGeometry(0.3, 0.55, 4, 8);
      }
    });
    const material = this.materials.acquire(color, () => new MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }));
    const mesh = new Mesh(geometry, material);
    this.releases.set(mesh, () => { this.geometry.release(shape); this.materials.release(color); });
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
}
