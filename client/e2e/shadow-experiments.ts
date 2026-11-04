import { Vector3 } from 'three';
import type { DirectionalLight, WebGLRenderer } from 'three';
import type { ThreeRenderer } from '../src/render/three/ThreeRenderer';

export type ShadowVariant = 'baseline' | 'tight' | 'snap';
/** Test-only access to engine state. No experiment switch ships in GameApp. */
export function shadowExperiment(renderer: ThreeRenderer, variant: ShadowVariant): () => void {
  const fixture = renderer as unknown as { renderer: WebGLRenderer; sun: DirectionalLight };
  const light = fixture.sun, camera = light.shadow.camera;
  if (variant === 'tight') {
    Object.assign(camera, { left: -18, right: 18, top: 18, bottom: -18 }); camera.updateProjectionMatrix();
  }
  if (variant !== 'snap') return () => {};
  const original = fixture.renderer.shadowMap.render;
  const direction = new Vector3(-18, -12, 12).normalize();
  const right = new Vector3().crossVectors(direction, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, direction).normalize();
  fixture.renderer.shadowMap.render = (...args) => {
    const texel = 48 / light.shadow.mapSize.x;
    const x = light.target.position.dot(right), y = light.target.position.dot(up);
    const dx = Math.round(x / texel) * texel - x, dy = Math.round(y / texel) * texel - y;
    Object.assign(camera, { left: -24 + dx, right: 24 + dx, bottom: -24 + dy, top: 24 + dy }); camera.updateProjectionMatrix();
    return original.apply(fixture.renderer.shadowMap, args);
  };
  return () => { fixture.renderer.shadowMap.render = original; };
}
