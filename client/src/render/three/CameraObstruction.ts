import { Raycaster, Vector3 } from 'three';
import type { Intersection, Object3D } from 'three';
import { CHARACTER_MOTION, damp } from './CharacterMotion';
import { CameraRaycast } from './CameraRaycast';

const PROBES = [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]] as const;

/** Near-plane corner probes, immediate retraction and damped release. */
export class CameraObstruction {
  private readonly ray = new Raycaster();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly origin = new Vector3();
  private readonly lastTarget = new Vector3();
  private distance: number | null = null;
  private readonly geometry = new CameraRaycast();
  private readonly hits: Intersection[] = [];

  resolve(target: Vector3, direction: Vector3, desired: number, halfWidth: number, halfHeight: number, obstacles: Object3D[], dt: number): number {
    this.right.set(direction.z,0,-direction.x).normalize();
    this.up.crossVectors(direction,this.right).normalize();
    let allowed = desired;
    for (const obstacle of obstacles) this.geometry.prepare(obstacle, this.ray.params.Line.threshold);
    for (const [x,y] of PROBES) {
      this.origin.copy(target).addScaledVector(this.right,x*halfWidth).addScaledVector(this.up,y*halfHeight);
      this.ray.set(this.origin,direction); this.ray.near=.05; this.ray.far=desired+.15;
      for (const obstacle of obstacles) this.geometry.intersect(obstacle, this.ray, this.hits);
      for (const hit of this.hits) allowed=Math.min(allowed,Math.max(.2,hit.distance-.15));
      this.hits.length = 0;
    }
    if (this.distance===null || this.lastTarget.distanceTo(target)>CHARACTER_MOTION.discontinuity) this.distance=allowed;
    else this.distance=allowed<this.distance?allowed:damp(this.distance,allowed,CHARACTER_MOTION.cameraReturnRate,Math.min(dt,.1));
    this.lastTarget.copy(target);
    return this.distance;
  }
}
