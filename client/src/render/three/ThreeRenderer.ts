import {
  BoxGeometry, CircleGeometry, Color, DirectionalLight, HemisphereLight,
  Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, WebGLRenderer,
} from 'three';
import type { RenderAdapter } from '../RenderAdapter';

export class ThreeRenderer implements RenderAdapter {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private cube: Mesh<BoxGeometry, MeshStandardMaterial> | null = null;
  private ground: Mesh<CircleGeometry, MeshStandardMaterial> | null = null;

  mount(container: HTMLElement): void {
    if (this.renderer) throw new Error('Сцена уже создана.');
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.domElement.setAttribute('aria-label', 'Трёхмерная сцена');
    this.renderer.domElement.setAttribute('role', 'img');
    this.scene = new Scene();
    this.scene.background = new Color('#111c26');
    this.camera = new PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(5, 3.8, 6);
    this.camera.lookAt(0, 0.6, 0);

    this.cube = new Mesh(
      new BoxGeometry(1.5, 1.5, 1.5),
      new MeshStandardMaterial({ color: '#71d9be', roughness: 0.35, metalness: 0.15 }),
    );
    this.cube.position.y = 1.2;
    this.ground = new Mesh(
      new CircleGeometry(3.1, 64),
      new MeshStandardMaterial({ color: '#243747', roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    const sun = new DirectionalLight('#fff0d6', 3);
    sun.position.set(3, 6, 4);
    this.scene.add(this.cube, this.ground, new HemisphereLight('#c5eaff', '#19252d', 2), sun);
    container.append(this.renderer.domElement);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (!this.renderer || !this.camera) return;
    this.camera.aspect = width / height;
    this.camera.fov = width < height ? 58 : 42;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
  }

  render(elapsedSeconds: number): void {
    if (!this.renderer || !this.scene || !this.camera || !this.cube) return;
    this.cube.rotation.set(0.15, elapsedSeconds * 0.3, 0.08);
    this.cube.position.y = 1.2 + Math.sin(elapsedSeconds) * 0.08;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    for (const mesh of [this.cube, this.ground]) {
      mesh?.geometry.dispose();
      mesh?.material.dispose();
    }
    this.scene?.clear();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
    }
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.cube = null;
    this.ground = null;
  }
}
