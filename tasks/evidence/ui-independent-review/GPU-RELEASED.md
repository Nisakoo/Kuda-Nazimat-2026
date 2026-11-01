# GPU released

Independent baseline capture is complete. All reviewer Chromium contexts, browser processes, and real peer sockets closed at 2026-11-01T02:33:52.563Z. Peer logout returned HTTP 204. No reviewer rendering is running. Main can render art, publish models, rebuild, and restart.

The deployed baseline was `index-Bb8RXsDf.js` in all fresh captures. Source-only corrections are not verified. The inventory focus defect is **R-06 · P2 · HUD-006–008 / UI-002**. Focus was already BODY before equip, not only after the ACK. Do not limit the cause to a disabled equip button.

The 90-second diagnostic wait does not pass the required 5-second readiness gate. Keep the frozen 15/47 and 4/8 results unchanged. Supplemental manual runs are not replacement acceptance suites.

Final evidence: `world-followup-results.json`, `world-final-baseline-results.json`, `fresh-world-followup/`, `fresh-world-final-baseline/`. The mislabeled followup `map-1622x970.png` is a reviewer capture mistake. Use `fresh-world-final-baseline/map-1622x970.png` instead.
