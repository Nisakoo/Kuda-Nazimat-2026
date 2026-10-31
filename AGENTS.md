# Project guide

Offline educational multiplayer 3D world. Browser clients use one LAN server for authority, auth, SQLite persistence, and local adaptive AI; solo play also works on the server laptop with Wi-Fi off.

- Start: [README.md](README.md); boundaries: [architecture.md](architecture.md); requirements: `specs/`; implementation/evidence: `tasks/`.
- Follow [.agents/skills/sdd/SKILL.md](.agents/skills/sdd/SKILL.md). Spec metadata separates document readiness from implementation progress.
- Planned client: `client/`, TypeScript strict, Vite, Svelte 5, Three.js only, Socket.IO Client, Vitest. No client code yet; server code belongs to a future separate project.
- Keep Core headless, dependencies acyclic, adapters isolated. GameApp composes modules; avoid empty abstractions.
- No runtime internet. Real game channels require auth; client world cache ≤10%. LocalSession/mock NPCs do not prove server or AI acceptance.
- NPC LLM plan: specs/server-llm-runtime.md and specs/npc-llm-evaluation.md. MLX/Ollama, one active model, total LLM RAM ≤4,000,000,000 bytes; profiles remain unverified.
- Commands: `make client`, `make client-test`; currently unconfigured until client implementation.
- Acceptance: run `make client-test` for client changes plus relevant type/build/scenario checks; record evidence and update docs/metadata. Missing configuration and unrun checks never count as passing.
