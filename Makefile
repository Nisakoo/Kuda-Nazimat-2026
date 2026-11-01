.DEFAULT_GOAL := help

# Commands run from the repo root; overrides remain available.
CLIENT_RUN_CMD ?= npm --prefix client run dev
CLIENT_TEST_CMD ?= npm --prefix client test

.PHONY: help client client-test

help:
	@printf '%s\n' 'make client       Start the Vite client (LAN access enabled)' 'make client-test  Run Vitest without watch' 'make server       Start the LAN server' 'make server-test  Run server/shared tests' 'make demo         Prepare client/world and start server' 'See README.md for installation, type checks, build and browser checks.'

client:
ifeq ($(strip $(CLIENT_RUN_CMD)),)
	@printf '%s\n' 'Client is not configured: set CLIENT_RUN_CMD when implementing the client.' >&2
	@exit 1
else
	$(CLIENT_RUN_CMD)
endif

client-test:
ifeq ($(strip $(CLIENT_TEST_CMD)),)
	@printf '%s\n' 'Client tests are not configured: set CLIENT_TEST_CMD when implementing the client.' >&2
	@exit 1
else
	$(CLIENT_TEST_CMD)
endif

.PHONY: server server-test prepare start demo
# PORT=9000 overrides the configured port (OFFLINE-003).
server:
	npm --prefix server start$(if $(PORT), -- --port $(PORT))

server-test:
	npm --prefix server test

# OFFLINE-001: idempotent; never touches the players' database.
prepare:
	@node -e "const [a,b]=process.versions.node.split('.').map(Number); if (a!==24||b<15) { console.error('Нужен Node 24.15+ в ветке 24, сейчас '+process.versions.node); process.exit(1); }"
	npm --prefix client ci
	npm --prefix server ci
	npm --prefix client run build
	npm --prefix server run lan:check$(if $(PORT), -- --port $(PORT))

# OFFLINE-002: works offline once prepared; dependencies are installed only when missing.
start:
	@test -d client/node_modules || npm --prefix client ci
	@test -d server/node_modules || npm --prefix server ci
	npm --prefix client run build
	$(MAKE) server

demo: start
