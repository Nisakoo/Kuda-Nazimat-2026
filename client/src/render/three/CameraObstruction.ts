import { Raycaster, Vector3 } from 'three';
import type { Intersection, Object3D } from 'three';
import { CHARACTER_MOTION, damp } from './CharacterMotion';
import { CameraRaycast } from './CameraRaycast';

const PROBES = [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
/** A still camera re-probes at this frame interval, for animated scenery moving into view. */
const STILL_REPROBE_FRAMES = 10;

/** Near-plane corner probes, immediate retraction and damped release. */
export class CameraObstruction {
  private readonly ray = new Raycaster();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly origin = new Vector3();
  private readonly lastTarget = new Vector3();
  private distance: number | null = null;
  private readonly probeTarget = new Vector3(NaN, NaN, NaN);
  private readonly probeDirection = new Vector3(NaN, NaN, NaN);
  private probeKey: readonly [number, number, number, readonly Object3D[], number] | null = null;
  private probeAllowed = 0;
  private stillFrames = 0;
  constructor(private readonly geometry = new CameraRaycast()) {}
  private readonly hits: Intersection[] = [];

  resolve(target: Vector3, direction: Vector3, desired: number, halfWidth: number, halfHeight: number, obstacles: readonly Object3D[], dt: number): number {
    const key = this.probeKey;
    const still = key !== null && key[0] === desired && key[1] === halfWidth && key[2] === halfHeight && key[3] === obstacles && key[4] === obstacles.length
      && this.probeTarget.equals(target) && this.probeDirection.equals(direction) && ++this.stillFrames < STILL_REPROBE_FRAMES;
    const allowed = still ? this.probeAllowed : this.probe(target, direction, desired, halfWidth, halfHeight, obstacles);
    if (!still) {
      this.probeKey = [desired, halfWidth, halfHeight, obstacles, obstacles.length]; this.stillFrames = 0;
      this.probeTarget.copy(target); this.probeDirection.copy(direction); this.probeAllowed = allowed;
    }
    if (this.distance===null || this.lastTarget.distanceTo(target)>CHARACTER_MOTION.discontinuity) this.distance=allowed;
    else this.distance=allowed<this.distance?allowed:damp(this.distance,allowed,CHARACTER_MOTION.cameraReturnRate,Math.min(dt,.1));
    this.lastTarget.copy(target);
    return this.distance;
  }

  /** Near-plane probes; skipped while the camera, its target and the obstacle set are unchanged. */
  private probe(target: Vector3, direction: Vector3, desired: number, halfWidth: number, halfHeight: number, obstacles: readonly Object3D[]): number {
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
    return allowed;
  }
}
