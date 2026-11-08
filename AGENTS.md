# Project guide

Offline multiplayer 3D language-learning game (stylized Babylon, up to 4 players). Browser clients (`client/`, Svelte 5 + Three.js) talk to one LAN server (`server/`, Node 24, Socket.IO, SQLite, local LLM for NPCs); `shared/` is the executable protocol contract. Solo play also works on the server laptop with Wi-Fi off. Docs are in Russian, AGENTS.md files in English.

## Commands
- Setup: `npm --prefix client ci`, `npm --prefix server ci`
- Run: `make client` (Vite stand), `make server` (development), `make start` (production, offline)
- Test: `make client-test`, `make server-test`; docs links: `make docs-check`

## Map of zones (read the nested file before editing that zone)
- `client/AGENTS.md` for `client/`; `client/src/render/AGENTS.md` for the renderer
- `server/AGENTS.md` for `server/`; `server/src/npc/AGENTS.md` for NPC dialogue; `server/llm/AGENTS.md` for Python LLM workers
- `shared/AGENTS.md` for `shared/` (the contract)
- Agents load nested files only when they work in that directory, so open the relevant one yourself.

## Docs and decisions
- `docs/README.md` is the index: read the relevant doc before work (`docs/game/`, `docs/tech/`).
- Check `docs/decisions/README.md` before changing anything it covers. Never edit an accepted decision; supersede it.
- Record a new architectural decision in the same PR: MADR file if costly to reverse, crosses zones or constrains everyone; otherwise a Y-statement `D-<PR number>` in the README.

## Never
- No runtime internet: no CDN, cloud API, external fonts, telemetry or downloads at run time or in tests.
- Do not change `client/` from server work (or `server/` from client work) without need; cross-zone changes go through `shared/`.
- Keep Core/domain headless, dependencies acyclic and pointing inward, adapters thin, one composition root (client `GameApp`, server `app`). No DI container, event bus or empty abstractions.
- LocalSession and mock NPCs prove neither server nor AI acceptance. Never claim a check passed without running it.
- Never commit screenshots, videos, logs, raw measurements, profiler dumps, test reports or source archives; use OS temp dirs or a path outside the repo.

## Done means
- Tests of the touched zone pass (`make client-test` / `make server-test`, plus the zone's `check`).
- Relevant docs, contract and decision are updated in the same PR.
- The PR description lists commands run with results and what was NOT verified.
