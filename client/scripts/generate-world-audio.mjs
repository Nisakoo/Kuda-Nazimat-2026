// Original procedural sound designs for NEXT-015. No recordings, samples, speech, or remote inputs.
// Run from any directory: node client/scripts/generate-world-audio.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const directory = new URL('../public/assets/audio/', import.meta.url);
await mkdir(directory, { recursive: true });
const sampleRate = 22050;
let seed = 42015;
const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
const sine = (phase) => Math.sin(2 * Math.PI * phase);
const bell = (t, length) => Math.sin(Math.PI * Math.min(1, Math.max(0, t / length))) ** 2;
const designs = [
  ['wind', 3.2, (t, duration, n, low) => bell(t, duration) * (low * 0.6 + n * 0.012)],
  ['birds', 1.35, (t) => { const p = t % 0.39; return p < 0.2 ? bell(p, 0.2) * (sine((1700 + 650 * p) * p) + 0.16 * sine(3600 * p)) * 0.13 : 0; }],
  ['grass', 1.7, (t, duration, n, low) => bell(t, duration) * (n - low) * (0.055 + 0.025 * sine(t * 3))],
  ['step', 0.19, (t, duration, n, low) => bell(t, duration) * Math.exp(-t * 22) * (0.3 * sine(125 * t) + 0.24 * low + 0.08 * n)],
  ['sprint', 0.15, (t, duration, n, low) => bell(t, duration) * Math.exp(-t * 28) * (0.36 * sine(145 * t) + 0.28 * low + 0.1 * n)],
  ['jump', 0.28, (t, duration, n) => bell(t, duration) * (0.13 * sine(230 * t + 140 * t * t) + n * 0.018)],
  // A closed-mouth, non-linguistic harmonic hum. It never receives message text.
  ['mumble', 0.57, (t, duration) => {
    const pulse = t < 0.26 ? bell(t, 0.26) : bell(t - 0.29, 0.28);
    const phase = 125 * t + 1.1 * sine(4 * t);
    return bell(t, duration) * pulse * (0.17 * sine(phase) + 0.065 * sine(2 * phase) + 0.025 * sine(3 * phase));
  }],
];
const files = [];
for (const [name, duration, design] of designs) {
  const frames = Math.round(sampleRate * duration);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  let low = 0;
  for (let frame = 0; frame < frames; frame++) {
    const n = noise(); low += (n - low) * 0.035;
    const value = Math.max(-0.8, Math.min(0.8, design(frame / sampleRate, frames / sampleRate, n, low)));
    wav.writeInt16LE(Math.round(value * 32767), 44 + frame * 2);
  }
  await writeFile(new URL(`${name}.wav`, directory), wav);
  files.push({ name, file: `${name}.wav`, bytes: wav.length, frames, sampleRate, channels: 1, sha256: createHash('sha256').update(wav).digest('hex') });
}
await writeFile(new URL('manifest.json', directory), `${JSON.stringify({ generator: 'client/scripts/generate-world-audio.mjs', seed: 42015, format: 'PCM16 mono WAV', files }, null, 2)}\n`);
console.log(`Generated ${files.length} original WAV files in ${fileURLToPath(directory)} (${files.reduce((sum, file) => sum + file.bytes, 0)} bytes)`);
