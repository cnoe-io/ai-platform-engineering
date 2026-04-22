"""Pytest config for the matrix-driver subtree — spec 102 task T055.

This conftest is intentionally **separate** from `tests/rbac/conftest.py`
to avoid pytest's recursive-conftest discovery loading the same fixtures
twice when the driver runs as a subprocess of another suite.

What this file provides
-----------------------
* `matrix_driver_row` — pytest fixture that yields each `(route, persona)`
  pair from `tests/rbac/unit/py/matrix_driver.py:expand_matrix()`. Used
  by the auto-generated `test_matrix.py` (and by ad-hoc phase tests that
  want to drive a single row).
* `audit_collection` — pymongo collection handle pointed at the e2e Mongo
  (read from `MONGODB_URI` / `AUDIT_COLLECTION` env vars). Skips the test
  if pymongo isn't installed *or* if Mongo is unreachable. Tests use this
  to assert the audit-log row written by `logAuthzDecision` /
  `log_authz_decision` (FR-007).
* `clean_authz_decisions` — autouse, function-scoped fixture that drops
  the `authz_decisions` collection between tests so per-route
  audit-log assertions don't see stale rows from earlier tests.

Notes
-----
* The persona fixtures (`alice_admin`, `bob_chat_user`, …) and the
  parametrised `persona` fixture are inherited from
  `tests/rbac/conftest.py` via pytest's normal upward conftest
  discovery — DO NOT redefine them here.
* The `--rbac-online` opt-in flag is also defined in
  `tests/rbac/conftest.py`. Tests that need the live stack should be
  decorated with `pytest.mark.rbac_online` so they skip cleanly in unit
  runs.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

import pytest

from tests.rbac.unit.py.matrix_driver import MatrixRow, matrix_param_set

DEFAULT_MONGODB_URI = "mongodb://localhost:27018"  # e2e override port (T032)
DEFAULT_AUDIT_DB = "caipe_audit"
DEFAULT_AUDIT_COLLECTION = "authz_decisions"


@pytest.fixture(params=list(matrix_param_set()))
def matrix_driver_row(request: pytest.FixtureRequest) -> MatrixRow:
    """Parameterised over every `(route, persona)` returned by the matrix driver.

    Returns the typed `MatrixRow` so tests can build their request via
    `call_surface(row, token)`.
    """
    return request.param


@pytest.fixture(scope="session")
def _pymongo_module() -> Any:
    """Lazily import pymongo. Returns the module or skips if unavailable."""
    try:
        import pymongo  # noqa: PLC0415

        return pymongo
    except Exception as exc:  # pragma: no cover - import-time check
        pytest.skip(f"pymongo not installed; skipping audit-log tests ({exc})")


@pytest.fixture(scope="session")
def audit_collection(_pymongo_module: Any) -> Any:
    """Return the live `authz_decisions` collection used for FR-007 assertions.

    Skips the test if Mongo is unreachable. The compose stack maps Mongo to
    `localhost:27018` per `docker-compose/docker-compose.e2e.override.yaml`;
    override via `MONGODB_URI=…`.
    """
    uri = os.environ.get("MONGODB_URI", DEFAULT_MONGODB_URI)
    db_name = os.environ.get("AUDIT_DB", DEFAULT_AUDIT_DB)
    coll_name = os.environ.get("AUDIT_COLLECTION", DEFAULT_AUDIT_COLLECTION)
    client = _pymongo_module.MongoClient(uri, serverSelectionTimeoutMS=2000)
    try:
        client.admin.command("ping")
    except Exception as exc:
        pytest.skip(f"Mongo unreachable at {uri}; skipping audit-log assertions ({exc})")
    return client[db_name][coll_name]


@pytest.fixture(autouse=True)
def clean_authz_decisions(request: pytest.FixtureRequest) -> Iterator[None]:
    """Drop the audit collection before/after each test that uses it.

    Implemented as autouse so individual tests don't have to remember; only
    actually fires when `audit_collection` is in the test's fixture closure
    (avoids hitting Mongo for tests that don't need it).
    """
    needs_audit = "audit_collection" in request.fixturenames
    if not needs_audit:
        yield
        return

    coll = request.getfixturevalue("audit_collection")
    coll.delete_many({})
    yield
    coll.delete_many({})


__all__ = [
    "audit_collection",
    "clean_authz_decisions",
    "matrix_driver_row",
]
