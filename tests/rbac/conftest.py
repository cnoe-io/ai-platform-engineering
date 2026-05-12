"""Pytest config + fixtures for the spec-102 RBAC suite (T017).

Per `data-model.md` §E5, this file exposes:
  - One named fixture per persona (`alice_admin`, `bob_chat_user`, …)
    returning a `PersonaToken`.
  - A parametrised `persona` fixture that yields each persona in turn — used
    by matrix-driven tests so a single test function exercises every persona.
  - A pytest `--rbac-online` flag (default off) so unit tests that don't need
    Keycloak skip cleanly when the compose stack isn't up.

Usage:
  # In a unit test (no Keycloak):
  def test_validator_does_X(): ...

  # In a Keycloak-backed integration test:
  pytestmark = pytest.mark.rbac_online

  def test_admin_route_for_persona(persona, http_client):
      r = http_client.get("/api/admin/users", headers={
          "Authorization": f"Bearer {persona.access_token}",
      })
      ...
"""

from __future__ import annotations

import os
from typing import Iterator

import pytest

from tests.rbac.fixtures.keycloak import (
    PERSONAS,
    PersonaToken,
    clear_persona_cache,
    get_persona_token,
)


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--rbac-online",
        action="store_true",
        default=False,
        help="Run tests marked rbac_online (require live Keycloak from docker-compose.dev.yaml).",
    )


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "rbac_online: requires live Keycloak (use --rbac-online to enable; default off in unit-test runs)",
    )


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    if config.getoption("--rbac-online"):
        return
    skip = pytest.mark.skip(
        reason="rbac_online tests require live Keycloak; pass --rbac-online or use make test-rbac"
    )
    for item in items:
        if "rbac_online" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session", autouse=True)
def _clear_persona_cache_at_session_start() -> Iterator[None]:
    """Drop any stale tokens before the session starts.

    Keeps test sessions hermetic — a previous run could have left tokens that
    are now expired or have stale roles after `init-idp.sh` re-ran.
    """
    clear_persona_cache()
    yield
    clear_persona_cache()


def _persona_fixture_factory(name):
    @pytest.fixture(scope="session")
    def _fixture() -> PersonaToken:
        return get_persona_token(name)

    _fixture.__doc__ = f"PersonaToken for {name} (cached for the test session)."
    return _fixture


# Generate one named fixture per persona (alice_admin, bob_chat_user, …).
alice_admin = _persona_fixture_factory("alice_admin")
bob_chat_user = _persona_fixture_factory("bob_chat_user")
carol_kb_ingestor = _persona_fixture_factory("carol_kb_ingestor")
dave_no_role = _persona_fixture_factory("dave_no_role")
eve_dynamic_agent_user = _persona_fixture_factory("eve_dynamic_agent_user")
frank_service_account = _persona_fixture_factory("frank_service_account")


@pytest.fixture(params=PERSONAS, ids=list(PERSONAS))
def persona(request: pytest.FixtureRequest) -> PersonaToken:
    """Yields each persona's `PersonaToken` in turn — used by matrix-driven tests."""
    return get_persona_token(request.param)


@pytest.fixture(scope="session")
def keycloak_base_url() -> str:
    """Base URL of the Keycloak instance used by the persona fixture."""
    return os.environ.get("KEYCLOAK_URL", "http://localhost:7080").rstrip("/")
