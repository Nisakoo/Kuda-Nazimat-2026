# Local LLM workers (Python)

- Python 3.12 managed by uv; each backend has its own lock (`envs/ollama`, `envs/mlx`). The server runtime invokes the prepared Python directly, never `uv` or `pip`.
- Never download models, packages or Python at runtime or in tests. Preparation (`make llm-prepare BACKEND=mlx|ollama`) is a separate one-time step with internet.
- Checks: `make llm-test` (offline unit tests through uv) and `make llm-lock-check` (locks match `pyproject.toml`). Change a dependency by updating its lock, then rerun both.
- Installation or update on a machine: follow `.agents/skills/install-local-ai/SKILL.md`; operator guides are SETUP.md, README.md, PROFILES.md, TIMEOUT.md, UPDATING.md in this directory.
- Fixtures and fake workers do not qualify a model; record unverified gates (RAM, p95, OS isolation) honestly in docs/tech/llm.md.
- Limits and architecture: docs/tech/llm.md; decision: docs/decisions/0008-single-local-llm-with-budget.md.
