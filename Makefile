.DEFAULT_GOAL := help

# Commands run from the repo root; overrides remain available.
CLIENT_RUN_CMD ?= npm --prefix client run dev
CLIENT_TEST_CMD ?= npm --prefix client test
NODE ?= node
UV ?= uv
# Startup values are environment data, never interpolated into shell commands.
export KUDA_LLM_BACKEND = $(BACKEND)
export KUDA_LLM_MODEL = $(MODEL)
export KUDA_LLM_PROFILES = $(LLM_PROFILES)
export KUDA_NPC_TIMEOUT = $(NPC_TIMEOUT)

.PHONY: help client client-test

help:
	@printf '%s\n' 'make client       Start the Vite client (LAN access enabled)' 'make client-test  Run Vitest without watch' 'make server       Start the server in development (ENV=production to override)' 'make server-test  Run server/shared tests' 'make prepare      Once, with internet: install, build client/world, self-check' 'make start        Offline delivery: build and start in production (alias: make demo)' 'make server BACKEND=ollama MODEL=2b NPC_TIMEOUT=60   Prepared model; whole seconds (1-300)' 'make llm-prepare BACKEND=mlx|ollama  Prepare locked Python dependencies with uv' 'make llm-test     Run offline Python fixtures using uv' 'make llm-lock-check  Check committed Python locks offline' 'make llm-import   One-time import of existing local 2B/0.8B configs; no downloads' 'NODE=/path/to/node and LLM_PROFILES=/path/to/profiles.json are optional overrides' 'See README.md for installation, type checks, build and browser checks.'

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

.PHONY: server server-test prepare start demo llm-import
.PHONY: llm-prepare llm-test llm-lock-check

# Preparation only: runtime never invokes uv or installs packages.
llm-prepare:
	"$(NODE)" server/llm/prepare.mjs

# Pure fixtures: require a prepared Python, never download during tests.
llm-test:
	$(UV) run --no-project --no-config --python 3.12 --no-python-downloads --offline python -B -m unittest discover -s server/llm -p 'test_*.py'

llm-lock-check:
	$(UV) lock --check --offline --no-python-downloads --project server/llm/envs/ollama
	$(UV) lock --check --offline --no-python-downloads --project server/llm/envs/mlx
# PORT=9000 overrides the configured port (OFFLINE-003); ENV picks the environment (SERVER-009), development by default.
ENV ?= development
export APP_ENV = $(ENV)
export PORT
server:
	"$(NODE)" server/src/app/main.ts

llm-import:
	"$(NODE)" server/src/cli/importLlmProfiles.ts

server-test:
	npm --prefix server test

# OFFLINE-001: idempotent; never touches the players' database.
prepare:
	@node -e "const [a,b]=process.versions.node.split('.').map(Number); if (a!==24||b<15) { console.error('Нужен Node 24.15+ в ветке 24, сейчас '+process.versions.node); process.exit(1); }"
	npm --prefix client ci
	npm --prefix server ci
	npm --prefix client run build
	npm --prefix server run tls -- init --env production
	npm --prefix server run lan:check -- --env production

# OFFLINE-002: works offline once prepared; dependencies are installed only when missing.
start:
	@test -d client/node_modules || npm --prefix client ci
	@test -d server/node_modules || npm --prefix server ci
	npm --prefix client run build
	$(MAKE) server ENV=production

demo: start
