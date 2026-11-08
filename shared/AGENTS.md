# Shared contract zone

`shared/` is the executable contract between client and server: protocol v3 types and validation, world and map formats, movement, fixtures.
- Pure TypeScript only: no dependencies, no DOM, no Node APIs (`npm --prefix server run check:platform` enforces it).
- Change it in a separate small PR. Both `make client-test` and `make server-test` must pass before merge.
- JSON fixtures are part of the contract: update them together with the code that changes them.
- A protocol change needs a docs/tech/protocol.md update and, if it breaks old clients, a decision (see docs/decisions/0004-game-protocol-socketio-v3.md and 0005).
