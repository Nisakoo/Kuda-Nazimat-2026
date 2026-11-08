# NPC dialogue zone

- One local model for all NPCs and BABEL translation. Default concurrency is 1 generation (2 only after qualification); at most 4 unfinished requests in total and at most 1 per player. Total LLM RAM stays at or below 4,000,000,000 bytes.
- Do not add a second model, a second queue or a model call from the browser. Technical failure must never produce a fake successful answer or a stored memory entry.
- NPC behaviour (language level, replies, attitude, memory, greetings) is specified in docs/game/npc.md and docs/game/cast.md. Read them before changing replies, attitude or memory, and check docs/decisions/README.md for the NPC decisions (three attitudes, memory scoped by AUTH session, en/es A2 only).
- History is scoped by `(AUTH sessionId, playerId, npcId)`; a new login starts new memory.
- Authoring a new resident: follow docs/game/npc.md, then add content under `server/content/`; scripted and fake workers do not prove model quality, say so in the PR.
- Worker, queue and timeout details: docs/tech/llm.md. Verify with `make server-test`.
