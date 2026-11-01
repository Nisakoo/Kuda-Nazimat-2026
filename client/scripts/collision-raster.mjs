/** Cover the actual polygon area, including posts smaller than a bitmap cell.
 * Clipping avoids expanding aligned edges into an extra row of blocked cells. */
export function rasterizePolygons(polygons, resolution, size = 32) {
  const bitmap = new Uint8Array(resolution * resolution), step = size / resolution, origin = -size / 2;
  function clip(points, axis, edge, greater) {
    const result = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const aInside = greater ? a[axis] >= edge : a[axis] <= edge;
      const bInside = greater ? b[axis] >= edge : b[axis] <= edge;
      if (aInside) result.push(a);
      if (aInside !== bInside) {
        const t = (edge - a[axis]) / (b[axis] - a[axis]);
        result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return result;
  }
  for (const polygon of polygons) {
    if (polygon.length < 3) continue;
    const xs = polygon.map(p => p[0]), zs = polygon.map(p => p[1]);
    const left = Math.max(0, Math.floor((Math.min(...xs) - origin) / step));
    const right = Math.min(resolution - 1, Math.ceil((Math.max(...xs) - origin) / step) - 1);
    const top = Math.max(0, Math.floor((Math.min(...zs) - origin) / step));
    const bottom = Math.min(resolution - 1, Math.ceil((Math.max(...zs) - origin) / step) - 1);
    for (let z = top; z <= bottom; z++) for (let x = left; x <= right; x++) {
      const index = z * resolution + x;
      if (bitmap[index]) continue;
      const minX = origin + x * step, minZ = origin + z * step;
      let clipped = clip(polygon, 0, minX, true);
      clipped = clip(clipped, 0, minX + step, false);
      clipped = clip(clipped, 1, minZ, true);
      clipped = clip(clipped, 1, minZ + step, false);
      const twiceArea = clipped.reduce((sum, a, i) => {
        const b = clipped[(i + 1) % clipped.length];
        return sum + (a[0] - minX) * (b[1] - minZ) - (b[0] - minX) * (a[1] - minZ);
      }, 0);
      if (Math.abs(twiceArea) > 1e-10) bitmap[index] = 1;
    }
  }
  return bitmap;
}
