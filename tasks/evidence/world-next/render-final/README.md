# Render evidence — not a complete motion qualification

The completed 14-case run had **6 passed and 8 failed**. See [the full log](../final-render-browser-v3.log) and [the cadence summary](../render-cadence-summary.json).

Every stored motion WebM is partial: `completed:false`, 24–31 simulated frames, approximately 1.57–2.01 actual FPS. These files do not prove a complete 4-second 30/60 FPS walk/sprint/jump/carry/place cycle.

The names `sprint.png` and `jump.png` identify wall-clock capture attempts. They do not prove that the simulation reached these phases on this slow host.

The 6 passing cases cover resources/import/retry/unload, catalogue sharing/release, and isolated cats/flock rendering/release. The original catalogue PNG has an occluding default test avatar. A subsequent harness-only framing fix removed it. The [final catalogue image](../catalogue-framed.png) and [focused passing rerun](../catalogue-framing-browser.log) are the current catalogue visual evidence.

These fixtures do not replace the live production route, target-hardware profile, physical LAN/Wi-Fi-off tests, or human listening.
