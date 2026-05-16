"""Matrix-driven pytest test — spec 102 task T054.

Runs once per `(route × persona)` returned by
`tests/rbac/unit/py/matrix_driver.py:expand_matrix()` for the
**non-`ui_bff`** surfaces (supervisor, mcp, dynamic_agents, rag,
slack_bot). The Jest driver covers `ui_bff`.

How this test is decided
------------------------
Each parameterised invocation:

1. Loads the persona's cached token (auto-skips if Keycloak isn't up).
2. Dispatches the row through `call_surface(row, token)`.
3. Asserts the response status equals the matrix entry's
   `expectations[<persona>].status`.

When status >= 400, we also assert the matrix entry's `reason` matches
the response body's `reason` field (best-effort — the back-end is
expected to return a JSON envelope `{ "reason": "DENY_NO_CAPABILITY" }`
per FR-007). If the response isn't JSON or doesn't include a reason, we
log it and skip the reason assertion (the matrix linter still requires
the reason in the YAML, just not in every backend response shape).

When does this test actually run?
---------------------------------
* Always SKIPPED unless `--rbac-online` is passed (or
  `RBAC_ONLINE=1`-equivalent CI flag is set in `make test-rbac`).
* `migration_status: pending` rows are skipped with a clear message
  pointing at Phases 5–9 in `tasks.md`.
* Today (Phase 4 ship), no rows have `surface ∈ PYTHON_SURFACES`. The
  test will report `0 collected` for the parameterised ids — that's
  expected and informational. Phase 5 (US3) ships with the first MCP
  rows; this driver picks them up automatically.
"""

from __future__ import annotations

import json

import pytest

from tests.rbac.fixtures.keycloak import get_persona_token
from tests.rbac.unit.py.matrix_driver import MatrixRow, call_surface


@pytest.mark.rbac_online
def test_matrix_row(matrix_driver_row: MatrixRow) -> None:
    """One assertion per `(route, persona)`."""
    row = matrix_driver_row

    if row.skip_reason:
        pytest.skip(f"row {row.route_id!r} for {row.persona!r}: {row.skip_reason}")

    token = get_persona_token(row.persona)  # type: ignore[arg-type]
    resp = call_surface(row, token)

    assert resp.status_code == row.expected_status, (
        f"row {row.route_id!r} for persona {row.persona!r}: "
        f"expected {row.expected_status}, got {resp.status_code}. "
        f"Response body: {resp.text[:500]}"
    )

    if row.expected_reason and row.expected_status >= 400:
        try:
            body = resp.json()
        except json.JSONDecodeError:
            return
        actual_reason = body.get("reason") if isinstance(body, dict) else None
        if actual_reason is None:
            return
        assert actual_reason == row.expected_reason, (
            f"row {row.route_id!r} for persona {row.persona!r}: "
            f"expected reason {row.expected_reason!r}, got {actual_reason!r}. "
            f"Response body: {resp.text[:500]}"
        )
