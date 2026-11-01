import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rasterizePolygons } from './collision-raster.mjs';

const rectangle = (x0, z0, x1, z1) => [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const occupied = bitmap => [...bitmap].reduce((sum, value) => sum + value, 0);
const at = (bitmap, x, z) => bitmap[Math.floor((z + 16) * 4) * 128 + Math.floor((x + 16) * 4)];

test('thin support survives even when it misses every cell centre', () => {
  const bitmap = rasterizePolygons([rectangle(.01,.01,.06,.06)],128);
  assert.equal(at(bitmap,.03,.03),1);
  assert.equal(occupied(bitmap),1);
});
test('aligned obstacle does not invent an extra strip beside its boundary', () => {
  const bitmap = rasterizePolygons([rectangle(0,0,1,1)],128);
  assert.equal(occupied(bitmap),16);
  assert.equal(at(bitmap,1.01,.5),0);
  assert.equal(at(bitmap,.5,1.01),0);
});
test('rotated contour blocks its surface while its bounding-box corners remain clear', () => {
  const diamond = [[0,-1],[1,0],[0,1],[-1,0]];
  for (const polygon of [diamond,[...diamond].reverse()]) {
    const bitmap = rasterizePolygons([polygon],128);
    assert.equal(at(bitmap,.1,.1),1);
    assert.equal(at(bitmap,.9,.9),0);
    assert.equal(at(bitmap,-.9,-.9),0);
  }
});
test('concave contours retain their open courtyard', () => {
  const bitmap = rasterizePolygons([[[0,0],[2,0],[2,.5],[.5,.5],[.5,2],[0,2]]],128);
  assert.equal(at(bitmap,.2,1),1);
  assert.equal(at(bitmap,1,.2),1);
  assert.equal(at(bitmap,1,1),0);
});
test('chunk edges clip crossing shapes without wrapping into another row', () => {
  const bitmap = rasterizePolygons([rectangle(15.9,0,16.2,.2),rectangle(18,0,19,1)],128);
  assert.equal(occupied(bitmap),1);
  assert.equal(at(bitmap,15.99,.1),1);
  assert.equal(at(bitmap,-15.99,.3),0);
});
