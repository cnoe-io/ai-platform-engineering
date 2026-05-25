# Comprehensive RBAC Tests (`tests/rbac/`)

Cross-cutting RBAC test suite for spec [102-comprehensive-rbac-tests-and-completion](../../docs/docs/specs/102-comprehensive-rbac-tests-and-completion/spec.md).

See the developer-facing [`quickstart.md`](../../docs/docs/specs/102-comprehensive-rbac-tests-and-completion/quickstart.md) for end-to-end usage of `make test-rbac`.

## Layout

```text
tests/rbac/
├── conftest.py              # pytest persona fixtures (alice, bob, carol, dave, eve, frank)
├── rbac-matrix.yaml         # single source of truth — every gate × every persona
├── fixtures/                # shared helpers (TS + Py persona token mint, audit assertions, RAG seed, stub MCP)
├── unit/
│   ├── py/                  # pytest matrix driver + per-surface tests
│   └── ts/                  # Jest matrix driver (BFF routes)
└── e2e/                     # Playwright specs — one per user story
```

## Quick run

```bash
make test-rbac          # full suite (Jest + pytest + Playwright via the e2e compose stack)
make test-rbac-jest     # BFF unit only (~2 min)
make test-rbac-pytest   # backend unit only (~3 min)
make test-rbac-e2e      # Playwright only (~4 min)
```

The compose stack used by these tests is `docker-compose.dev.yaml` driven by `COMPOSE_PROFILES` — there is **no** separate e2e compose file. The e2e lane inlines a few `${VAR:-default}` substitutions (host port for Mongo/supervisor, `RBAC_FALLBACK_*`, `E2E_RUN`) into the dev compose file, activated by env vars set in the Makefile (`E2E_COMPOSE_ENV`). See [spec.md Clarifications 2026-04-22](../../docs/docs/specs/102-comprehensive-rbac-tests-and-completion/spec.md#session-2026-04-22) and `Makefile` `test-rbac-up`.
