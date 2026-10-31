.DEFAULT_GOAL := help

# Set defaults when implementing the client. Commands run from the repo root.
CLIENT_RUN_CMD ?=
CLIENT_TEST_CMD ?=

.PHONY: help client client-test

help:
	@printf '%s\n' 'make client       Start the client' 'make client-test  Run client tests' 'Client commands await implementation; see README.md.'

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
