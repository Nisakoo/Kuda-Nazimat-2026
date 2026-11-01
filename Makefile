.DEFAULT_GOAL := help

# Commands run from the repo root; overrides remain available.
CLIENT_RUN_CMD ?= npm --prefix client run dev
CLIENT_TEST_CMD ?= npm --prefix client test
NODE ?= node
# Export values as data, not interpolated shell arguments. Empty values keep the saved choice.
export KUDA_LLM_BACKEND = $(BACKEND)
export KUDA_LLM_MODEL = $(MODEL)
export KUDA_LLM_PROFILES = $(LLM_PROFILES)

.PHONY: help client client-test

help:
	@printf '%s\n' 'make client       Start the Vite client (LAN access enabled)' 'make client-test  Run Vitest without watch' 'make server       Start the LAN server' 'make server-test  Run server/shared tests' 'make demo         Prepare client/world and start server' 'make server BACKEND=ollama MODEL=2b   Use a prepared profile for one run' 'make llm-import   Import existing local profiles and select Ollama 2B (no downloads)' 'NODE=/path/to/node and LLM_PROFILES=/path/to/profiles.json are optional overrides'  'See README.md for installation, type checks, build and browser checks.'

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

.PHONY: server server-test demo llm-import
server:
	$(NODE) server/src/app/main.ts

llm-import:
	$(NODE) server/src/cli/importLlmProfiles.ts

server-test:
	npm --prefix server test

demo:
	@test -d client/node_modules || npm --prefix client ci
	@test -d server/node_modules || npm --prefix server ci
	npm --prefix client run build
	$(MAKE) server
