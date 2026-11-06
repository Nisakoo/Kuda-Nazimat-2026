# Client zone

Stack: TypeScript strict, Vite, Svelte 5, Three.js as the only engine, Socket.IO Client, Vitest. No SvelteKit, DI container or second engine.
- Verify with `make client-test` and `npm --prefix client run check` (plus `check:imports` for module boundaries and `build` for UI changes).
- Core (`src/core`, `src/session`, GameLoop) must compile without DOM/Node (`check:core`). Socket.IO Client is visible only to `SocketIOAdapter`; UI never imports `ThreeRenderer` or the adapter.
- World window is at most 25 chunks; models and textures are shared resources; the 128 MiB payload guard (`WorldBudget`) reserves memory until the last CPU/GPU owner releases. Do not raise these limits without a decision.
- `LocalSession` and the mock network are the Vite stand only; real play is `OnlineSession` against the server. Never present mock behaviour as server behaviour.
- Server authority (movement, items, NPC, translation) is not reimplemented in the client; the client sends intents.
- Generated world files and `client/dist` are not committed; browser/render artifacts go outside the repo (`TEST_ARTIFACT_DIR`).
- Docs: docs/tech/client.md, docs/game/ui.md, docs/game/art-style.md, docs/tech/protocol.md.
