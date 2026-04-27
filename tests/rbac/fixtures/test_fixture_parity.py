"""Spec 102 T031 — TS↔Py persona-fixture parity smoke test.

For each persona, mint a token via the Py fixture and again via the TS fixture
(invoked by `node -e`). Assert that the decoded `sub` claim matches — proving
both fixtures hit the same Keycloak realm with the same client credentials.

This is the cheapest possible parity guard. The full request-payload parity
test lives in `tests/rbac/unit/py/test_helper_parity.py` (T030).

Marked `rbac_online` because it needs a live Keycloak from `make test-rbac-up`.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.rbac_online

from tests.rbac.fixtures.keycloak import (  # noqa: E402
    PERSONAS,
    PersonaName,
    get_persona_token,
)


_REPO_ROOT = Path(__file__).resolve().parents[3]


def _decode_sub(jwt_token: str) -> str:
    payload_b64 = jwt_token.split(".")[1]
    padding = 4 - len(payload_b64) % 4
    if padding != 4:
        payload_b64 += "=" * padding
    return json.loads(base64.urlsafe_b64decode(payload_b64))["sub"]


def _ts_persona_token(persona: PersonaName) -> str:
    """Mint a token via the TS fixture by shelling out to `node -e`."""
    fixture_js = _REPO_ROOT / "tests/rbac/fixtures/keycloak.js"  # post-build (tsc --outDir tests/rbac/fixtures)
    if not fixture_js.is_file():
        pytest.skip(f"TS fixture not compiled at {fixture_js}; run `tsc tests/rbac/fixtures/keycloak.ts`")

    script = r"""
        const { getPersonaToken } = require(process.argv[1]);
        const persona = process.argv[2];
        getPersonaToken(persona)
          .then(t => process.stdout.write(t.accessToken))
          .catch(e => { process.stderr.write(String(e)); process.exit(1); });
    """
    result = subprocess.run(
        ["node", "-e", script, str(fixture_js), persona],
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
        env={**os.environ},
    )
    return result.stdout.strip()


@pytest.mark.parametrize("persona", PERSONAS)
def test_ts_py_persona_fixture_yield_same_sub(persona: PersonaName) -> None:
    """Both fixtures point at the same realm — minted tokens MUST share `sub`."""
    py_token = get_persona_token(persona).access_token
    ts_token = _ts_persona_token(persona)

    assert _decode_sub(py_token) == _decode_sub(ts_token), (
        f"persona {persona}: Py and TS fixtures resolved to different Keycloak users — "
        f"check KEYCLOAK_URL/KEYCLOAK_REALM env parity"
    )
