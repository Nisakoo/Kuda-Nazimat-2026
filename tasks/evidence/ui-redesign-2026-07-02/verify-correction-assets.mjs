import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const base = 'client/public/';
const approval = JSON.parse(readFileSync('tasks/evidence/ui-independent-review/avatar-v4-approval-receipt.json', 'utf8'));
const modelMeta = JSON.parse(readFileSync(base + 'assets/models/avatars/models.json', 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const models = approval.records.map(record => {
  const path = 'assets/models/avatars/' + record.id + '.glb';
  const bytes = readFileSync(base + path);
  assert.equal(bytes.length, record.bytes);
  assert.equal(digest(bytes), record.sha256);
  assert.equal(modelMeta.models.find(model => model.id === record.id)?.bytes, bytes.length);
  assert.equal(digest(readFileSync('client/dist/' + path)), record.sha256);
  const portrait = 'assets/models/avatars/' + record.id + '-portrait.png';
  const png = readFileSync(base + portrait);
  assert.deepEqual(readFileSync('client/dist/' + portrait), png);
  return { id: record.id, bytes: bytes.length, sha256: digest(bytes), portraitBytes: png.length, portraitSha256: digest(png) };
});
const limit = 64 * 1024 * 1024;
const worlds = ['maps/demo/manifest.json', 'maps/demo/science.json', 'maps/market/manifest.json'].map(path => {
  const raw = readFileSync(base + path);
  const manifest = JSON.parse(raw);
  const resources = new Map();
  const add = (url, expected) => {
    const size = statSync(base + url).size;
    assert.equal(size, expected, path + ': physical size ' + url);
    if (resources.has(url)) assert.equal(resources.get(url), expected);
    resources.set(url, expected);
  };
  for (const [url, meta] of Object.entries(manifest.assets)) add(url, meta.bytes);
  for (const chunk of manifest.chunks) { add(chunk.url, chunk.bytes); add(chunk.collisionUrl, chunk.collisionBytes); }
  const actualWorldBytes = raw.length + [...resources.values()].reduce((sum, bytes) => sum + bytes, 0);
  assert.equal(actualWorldBytes, manifest.worldBytes, path + ': worldBytes');
  assert.ok(actualWorldBytes <= limit, path + ': payload cap');
  for (const model of models) assert.equal(manifest.assets['assets/models/avatars/' + model.id + '.glb']?.bytes, model.bytes);
  const manifestMemory = Math.max(131072, raw.length * 16);
  const assetMemory = Object.values(manifest.assets).reduce((sum, meta) => sum + meta.memory, 0);
  const largest25ChunkMemory = manifest.chunks.map(chunk => Math.max(131072, chunk.bytes * 16) + Math.max(131072, chunk.collisionBytes * 3)).sort((a, b) => b - a).slice(0, 25).reduce((sum, memory) => sum + memory, 0);
  const conservativeMemory = manifestMemory + assetMemory + largest25ChunkMemory;
  assert.ok(conservativeMemory <= limit, path + ': declared conservative budget');
  assert.deepEqual(readFileSync('client/dist/' + path), raw);
  return { path, worldBytes: actualWorldBytes, manifestBytes: raw.length, manifestMemory, assetMemory, largest25ChunkMemory, conservativeMemory, limit, margin: limit - conservativeMemory };
});
const receipt = { at: new Date().toISOString(), scope: 'Static publication audit. Exact approved source/dist GLBs, refreshed static portraits, physical manifest/chunk/collision/asset byte equality and unchanged 64 MiB declared budget. Not actual JS/GPU/RSS measurement or runtime/LAN acceptance.', models, worlds };
writeFileSync('tasks/evidence/ui-redesign-2026-07-02/correction-assets-receipt.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
