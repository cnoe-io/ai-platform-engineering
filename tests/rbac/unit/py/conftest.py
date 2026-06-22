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
* Audit assertions live in `tests/rbac/fixtures/audit.py` and query
  audit-service. Audit storage is append-only from these tests.

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

import pytest

from tests.rbac.unit.py.matrix_driver import MatrixRow, matrix_param_set


@pytest.fixture(params=list(matrix_param_set()))
def matrix_driver_row(request: pytest.FixtureRequest) -> MatrixRow:
    """Parameterised over every `(route, persona)` returned by the matrix driver.

    Returns the typed `MatrixRow` so tests can build their request via
    `call_surface(row, token)`.
    """
    return request.param


__all__ = [
    "matrix_driver_row",
]
