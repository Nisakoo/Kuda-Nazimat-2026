# Password-auth integration — completed

The worker completed the previously delegated integration. There is no remaining AUTH wiring step.

- `database.ts` composes `sqliteAuthStores(db)` from `persistence/authentication.ts`; other stores remain unchanged.
- Migration 004 creates credentials. Migration 003 remains the avatar migration; migration 005 remains the equipment migration.
- `AuthService` provides register/login/guest/logout/state/verify/onRevoked. Successful auth responses remain exactly `{token,expiresAt}`.
- HTTP routes are `/api/auth/register` (201), `/api/auth/login` (200), `/api/auth/guest` (200), `/api/auth/logout` (204), `/api/auth/state` (200).
- Credential routes accept exact `{name,password}`; guest accepts `{name}`; logout accepts no body or `{}`. Bodies are limited to 1 KiB. Errors are `{error:{code,message}}`; codes include INVALID, INVALID_CREDENTIALS, NAME_TAKEN, RATE_LIMIT and FULL (503).
- The TCP remote address supplies the limiter source. Forwarded headers are not trusted.
- Pending state is `account_credentials exists AND players.avatar_id IS NULL`. Guest accounts remain playable.
- The Socket.IO join gate checks state, while handshake/avatar APIs remain available to pending accounts.
- Revocation deletes only the selected session hash. A targeted callback closes only that session's sockets. Disconnect cancels NPC; HTTP logout also cancels `babel:<sessionHash>`. Async BABEL authorization prevents late commit.
- `GameRuntime.canAdmit` delegates GameService.canAdmit. Authentication checks capacity before session issuance and before new account creation. Existing seats retain takeover rights.
- Authenticated GET/POST `/api/equipment` is wired with strict `{tool:'bag'|'jug'|null}`, server persistence and immediate game updates. No NEXT gameplay actions were added.
- Authenticated `/api/avatar/models/{id}.glb` remains intact.

Latest checks and remaining full-suite/model-manifest blocker: `tasks/evidence/task-045-password-auth.md`.
