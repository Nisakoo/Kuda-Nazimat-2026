# Server zone

Node 24.15+ (branch 24), TypeScript strict, Socket.IO, built-in `node:sqlite`, Vitest. No web framework or build step; Node strips types, `tsc --noEmit` only checks.
- Verify with `make server-test` and `npm --prefix server run check` (types, shared purity, dependency-cruiser). Never touch `client/`.
- Real game channels (Socket.IO, `/world/*`, game HTTP) require an authenticated session; production accepts password login only.
- Migrations are append-only: add `server/src/persistence/migrations/NNN.sql` with the next number, never edit an existing one. The game step must not call the database.
- Environment comes from `--env` / `APP_ENV` (`development`, `production`, `test`); unknown names are an error. Production never allows login without a password.
- One composition root (`src/app`); domain and services never import adapters. Wire format and limits live in `shared/` and its tests.
- NPC and translation (BABEL) share one model and one queue; see `src/npc/AGENTS.md` and `llm/AGENTS.md`.
- Never store logs, SQLite files, certificates or reports in the repo (`server/data/` and `server/config.json` are ignored).
- Docs: docs/tech/server.md, docs/tech/operations.md, docs/tech/protocol.md, docs/tech/setup.md.
