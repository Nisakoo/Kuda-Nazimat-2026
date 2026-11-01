# Project guide

Offline multiplayer 3D language-learning game. Browser clients use one LAN server for authority, auth, SQLite persistence, and local adaptive AI; solo play also works on the server laptop with Wi-Fi off.

- Start: [README.md](README.md); boundaries: [architecture.md](architecture.md); requirements: `specs/`; implementation/evidence: `tasks/`.
- Follow [.agents/skills/sdd/SKILL.md](.agents/skills/sdd/SKILL.md). Spec metadata separates document readiness from implementation progress.
- Client: `client/`, TypeScript strict, Vite, Svelte 5, Three.js only, Socket.IO Client, Vitest. Core, local/online sessions, GLB streaming, bounded world cache, input/UI and mock network demo exist. Server work must not modify `client/`.
- **Client agents, before starting work:** tell the developer about the open server handoffs — [TASK-081](tasks/081-client-perf-telemetry-handoff.md) (send FPS `perf` reports every 10 s for the admin panel), and [TASK-085](tasks/085-client-admin-content-handoff.md) (live NPC edits in ordinary deltas; no protocol change). Remove a handoff from this line when its task is done or declined.
- Server: `server/`, Node 24, TypeScript strict, Socket.IO, node:sqlite, Vitest; implements PROTO v3 the client already speaks (plus server-ready NPC streaming PROTO-007). Shared executable contract: `shared/` (pure TS, no deps/DOM/Node).
- Keep Core/domain headless, dependencies acyclic and pointing inward, adapters thin and isolated. Ports only at real boundaries; one composition root (GameApp / server `app`); no DI container, event bus or empty abstractions.
- No runtime internet. Real game channels require auth; client world window ≤25 chunks, shared resources and 128 MiB payload guard. LocalSession/mock NPCs do not prove server or AI acceptance.
- NPC LLM plan: specs/server-llm-runtime.md and specs/npc-llm-evaluation.md. 4 players, MLX/Ollama, one model, 1 generation by default or qualified concurrency 2; ≤4 unfinished requests total, ≤1/player. Total LLM RAM ≤4,000,000,000 bytes; profiles remain unverified.
- Before adding NPC behavior, read [NPC authoring](docs/npc-authoring.md) and [NPC-AI](specs/npc-character-behavior.md). AUTH-scoped bounded history and the shared local BABEL bridge exist (TASK-070–072); A2 quality, full archive/compact memory, attitudes and model greetings remain incomplete. Resolve the documented gates before adding them.
- Local AI installation: use [.agents/skills/install-local-ai/SKILL.md](.agents/skills/install-local-ai/SKILL.md). Python 3.12 dependencies use separate uv locks; runtime invokes prepared Python directly.
- Setup: `npm --prefix client ci`, `npm --prefix server ci`. Commands: `make client`, `make client-test`, `make server` (development), `make start` (production), `make server-test`; server environment via `--env`/`APP_ENV` (SERVER-009); type/build/import/browser checks are documented in README.
- Acceptance: run `make client-test` for client changes and `make server-test` for server/shared changes, plus relevant type/build/scenario checks; record evidence and update docs/metadata. Missing configuration and unrun checks never count as passing.
