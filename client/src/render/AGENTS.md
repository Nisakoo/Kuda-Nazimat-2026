# Renderer zone

Rendering is Three.js only, behind `RenderAdapter`; Core and UI do not depend on it.
- Frame budget first: no allocations per frame (reuse vectors, matrices, arrays, closures); no new Mesh per frame; static meshes of streamed models are merged once per template; dynamic entities live in `EntityVisuals`.
- Graphics profiles `low` / `balanced` / `high` (`GraphicsQuality.ts`) change only render cost (DPR, antialiasing, shadows, fog, wind rate), never Core, protocol, collisions or the chunk window. `high` is never auto-selected.
- Every GPU resource has an owner and is released with its chunk or model; extra buffers (wind, shot traces, audio) are reserved in the same `WorldBudget`.
- Measure before and after a performance change on the same machine and profile; record concise results in the PR, not raw dumps in the repo.
- Verify with `make client-test`, `npm --prefix client run check:imports`, and for visual or WebGL changes `PLAYWRIGHT_CHANNEL=chrome npm --prefix client run test:render` (script `test:render` in `client/package.json`). Without a run, say it was not verified.
- Docs: docs/tech/client.md (sections "Рендер", "Профили графики"), docs/game/art-style.md.
