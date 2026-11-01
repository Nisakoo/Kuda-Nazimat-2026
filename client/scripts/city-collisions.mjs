import { volumeFromBox, compactVolumes } from './ceiling-volumes.mjs';

/** A circumscribed polygon bounds the round mesh without the old solid square corners. */
export function roundFootprint(x, z, radiusX, radiusZ = radiusX, segments = 16) {
  const padding = 1 / Math.cos(Math.PI / segments);
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index + .5) * Math.PI * 2 / segments;
    return [x + Math.cos(angle) * radiusX * padding, z + Math.sin(angle) * radiusZ * padding];
  });
}
function contains(polygon, x, z) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** Preserve reachable beams/cloth as height-aware volumes before district meshes are merged. */
export function cityOverheadVolumes(pieces, ground) {
  const volumes = [];
  for (const geometry of pieces) {
    if (!geometry.userData.citySolid) continue;
    geometry.computeBoundingBox(); const bounds = geometry.boundingBox;
    const width = bounds.max.x - bounds.min.x, depth = bounds.max.z - bounds.min.z;
    // Low detail may be stepped over; high roofs are above the player's jump envelope.
    // Thin inscriptions and individual foliage never become invisible walls.
    if (bounds.min.y < .35 || bounds.min.y > 3.1 || Math.max(width, depth) < .5 || Math.min(width, depth) < .049) continue;
    const corners = [[bounds.min.x, bounds.min.z], [bounds.max.x, bounds.min.z], [bounds.max.x, bounds.max.z], [bounds.min.x, bounds.max.z]];
    if (ground.some(polygon => corners.every(([x, z]) => contains(polygon, x, z)))) continue;
    volumes.push(volumeFromBox(bounds));
  }
  return compactVolumes(volumes);
}
