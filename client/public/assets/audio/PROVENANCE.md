# Original world audio · NEXT-015

All 7 WAV files are original procedural sound designs made for this repository during TASK-042. `client/scripts/generate-world-audio.mjs` is the complete reproducible source. It uses only Node built-ins, deterministic noise (seed 42015), harmonic oscillations, and amplitude envelopes. No samples, recordings, speech synthesis, third-party sound library, copied game sounds, or network resources are used.

The generated audio files are offered under **CC0-1.0** (public-domain dedication; https://creativecommons.org/publicdomain/zero/1.0/). This URL is documentation, not a runtime request. The generator code follows the repository's code licensing terms.

| File | Design | Duration |
|---|---|---:|
| `wind.wav` | Gentle filtered-noise gust | 3.20 s |
| `birds.wav` | Short rising sinusoidal chirps | 1.35 s |
| `grass.wav` | Soft high-frequency noise rustle | 1.70 s |
| `step.wav` | Damped low harmonic and noise contact | 0.19 s |
| `sprint.wav` | Shorter, slightly brighter contact | 0.15 s |
| `jump.wav` | Soft rising harmonic impulse | 0.28 s |
| `mumble.wav` | Two closed-mouth harmonic hum pulses; no linguistic input | 0.57 s |

Format: mono 22,050 Hz PCM16 little-endian WAV. `manifest.json` records exact lengths, frame counts, and SHA-256 hashes. Total delivered WAV bytes: **328,414**. Total decoded float32 PCM: **656,212 bytes**.

Regenerate offline from the repository root:

```sh
node client/scripts/generate-world-audio.mjs
```

These committed delivery files do not need a generator or external dependencies at runtime. Automated tests check hashes, headers, non-silence, unclipped peaks, and quiet endpoints. They do **not** prove subjective style, comfort, intelligibility, speaker output, or target-machine performance. Physical listening and target-hardware acceptance remain unverified.
