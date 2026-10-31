# Project guide

Offline educational multiplayer 3D world. Browser clients use one LAN server for authority, auth, SQLite persistence, and local adaptive AI; solo play also works on the server laptop with Wi-Fi off.

- Start: [README.md](README.md); boundaries: [architecture.md](architecture.md); requirements: `specs/`; implementation/evidence: `tasks/`.
- Follow [.agents/skills/sdd/SKILL.md](.agents/skills/sdd/SKILL.md). Spec metadata separates document readiness from implementation progress.
- Client foundation: `client/`, TypeScript strict, Vite, Svelte 5, Three.js only, Vitest. Socket.IO Client is installed for a later adapter; Core, sessions and world streaming are pending. Server code belongs to a future separate project.
- Keep Core headless, dependencies acyclic, adapters isolated. GameApp composes modules; avoid empty abstractions.
- No runtime internet. Real game channels require auth; client world cache ≤10%. LocalSession/mock NPCs do not prove server or AI acceptance.
- NPC LLM plan: specs/server-llm-runtime.md and specs/npc-llm-evaluation.md. 4 players, MLX/Ollama, one model, 1 generation by default or qualified concurrency 2; ≤4 unfinished requests total, ≤1/player. Total LLM RAM ≤4,000,000,000 bytes; profiles remain unverified.
- Setup: `npm --prefix client ci`. Commands: `make client`, `make client-test`; type/build/import/browser checks are documented in README.
- Acceptance: run `make client-test` for client changes plus relevant type/build/scenario checks; record evidence and update docs/metadata. Missing configuration and unrun checks never count as passing.
