"""Regression tests for generic remote-MCP OAuth client registration."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
CHART_KEYCLOAK = REPO_ROOT / "charts" / "ai-platform-engineering" / "charts" / "keycloak"
REALM_FILES = (
  CHART_KEYCLOAK / "realm-config.json",
  REPO_ROOT / "deploy" / "keycloak" / "realm-config.example.json",
)
INIT_SCRIPTS = (
  CHART_KEYCLOAK / "scripts" / "init-idp.sh",
  CHART_KEYCLOAK / "scripts" / "init-token-exchange.sh",
)
MCP_DCR_HELPER = CHART_KEYCLOAK / "scripts" / "mcp-dcr.sh"
MCP_SCOPES = {
  "basic",
  "openid",
  "profile",
  "email",
  "roles",
  "groups",
  "org",
  "offline_access",
}


def _load_realm(path: Path) -> dict[str, Any]:
  return json.loads(path.read_text())


def test_realm_allows_anonymous_dcr_for_the_mcp_scope_set() -> None:
  for path in REALM_FILES:
    realm = _load_realm(path)
    scope_names = {scope["name"] for scope in realm["clientScopes"]}
    assert "basic" in scope_names, f"{path} must define Keycloak's DCR basic scope"

    policies = realm["components"]["org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy"]
    scope_policy = next(policy for policy in policies if policy["providerId"] == "allowed-client-templates" and policy["subType"] == "anonymous")
    allowed = set(scope_policy["config"]["allowed-client-scopes"])
    assert MCP_SCOPES <= allowed
    assert scope_policy["config"]["allow-default-scopes"] == ["true"]


def test_realm_enforces_s256_for_anonymous_public_oidc_clients() -> None:
  for path in REALM_FILES:
    realm = _load_realm(path)
    profile = next(item for item in realm["clientProfiles"]["profiles"] if item["name"] == "mcp-public-pkce")
    assert profile["executors"] == [
      {
        "executor": "pkce-enforcer",
        "configuration": {"auto-configure": True},
      }
    ]

    policy = next(item for item in realm["clientPolicies"]["policies"] if item["name"] == "mcp-public-dcr-pkce")
    assert policy["enabled"] is True
    assert policy["profiles"] == ["mcp-public-pkce"]
    assert policy["conditions"] == [
      {
        "condition": "client-updater-context",
        "configuration": {"update-client-source": ["ByAnonymous"]},
      },
      {
        "condition": "client-type",
        "configuration": {"protocol": "openid-connect"},
      },
      {
        "condition": "client-access-type",
        "configuration": {"type": ["public"]},
      },
    ]


def test_persistent_realm_init_paths_share_a_best_effort_dcr_reconcile() -> None:
  helper = MCP_DCR_HELPER.read_text()
  assert "_reconcile_mcp_dynamic_client_registration()" in helper
  assert "/client-scopes" in helper
  assert "/client-policies/profiles" in helper
  assert "/client-policies/policies" in helper
  assert '"pkce-enforcer"' in helper
  for scope in MCP_SCOPES:
    assert f'"{scope}"' in helper

  for path in INIT_SCRIPTS:
    script = path.read_text()
    assert 'MCP_DCR_HELPER_PATH:-/scripts/mcp-dcr.sh' in script
    assert '. "${MCP_DCR_HELPER}"' in script
    assert "if ! _reconcile_mcp_dynamic_client_registration" in script
    assert "MCP DCR reconcile failed" in script
    assert "/client-policies/profiles" not in script


def test_mcp_dcr_helper_is_packaged_for_helm_and_compose() -> None:
  config_map = (CHART_KEYCLOAK / "templates" / "configmap-init-scripts.yaml").read_text()
  assert '.Files.Get "scripts/mcp-dcr.sh"' in config_map

  for name in ("docker-compose.yaml", "docker-compose.dev.yaml", "docker-compose.tome.yaml"):
    compose = (REPO_ROOT / name).read_text()
    mount = "./charts/ai-platform-engineering/charts/keycloak/scripts/mcp-dcr.sh:/scripts/mcp-dcr.sh:ro"
    assert compose.count(mount) == 2
