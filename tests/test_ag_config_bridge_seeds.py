"""Unit tests for the agentgateway config-bridge seed inventory.

Spec 102 BLOCKERS §1.1 — RBAC enforcement at the agentgateway hop.

These tests assert structural invariants on the SEED_BACKENDS / SEED_POLICIES
constants in `deploy/agentgateway/config-bridge.py` so we don't accidentally:

  - drop an MCP backend (regression),
  - re-introduce AWS / ServiceNow as standalone backends (they're embedded
    in their agent containers and not gateway-routable),
  - leave a backend without an invoke policy (open-by-default = bug),
  - mismatch backend ids between BACKENDS and POLICIES.

The bridge is not importable as a regular module (no __init__.py), so we
load it via importlib directly from disk.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BRIDGE_PATH = ROOT / "deploy" / "agentgateway" / "config-bridge.py"


@pytest.fixture(scope="module")
def bridge():
    """Load `config-bridge.py` as a module without executing main()."""
    if not BRIDGE_PATH.exists():
        pytest.skip(f"config-bridge.py missing at {BRIDGE_PATH}")

    # The module imports jinja2 + pymongo at top-level. Stub them when not
    # installed so this test can run in isolated environments (e.g. the
    # supervisor venv that doesn't pull in the bridge's deps).
    for missing in ("jinja2", "pymongo"):
        if missing not in sys.modules:
            try:
                __import__(missing)
            except ImportError:
                stub = type(sys)(missing)
                if missing == "jinja2":
                    stub.Environment = object
                    stub.FileSystemLoader = object
                if missing == "pymongo":
                    stub.MongoClient = object
                sys.modules[missing] = stub

    spec = importlib.util.spec_from_file_location("ag_config_bridge", BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


# Standalone MCPs that MUST be routed through agentgateway. AWS and ServiceNow
# are intentionally absent (embedded inside their agent containers).
EXPECTED_BACKEND_IDS = {
    "rag",
    "mcp_jira",
    "mcp_argocd",
    "mcp_github",
    "mcp_slack",
    "mcp_confluence",
    "mcp_backstage",
    "mcp_pagerduty",
    "mcp_splunk",
    "mcp_webex",
    "mcp_komodor",
}

# Backends that MUST NOT appear because they're embedded.
FORBIDDEN_BACKEND_IDS = {"mcp_aws", "mcp_servicenow"}


class TestSeedBackends:
    def test_all_expected_backends_present(self, bridge):
        actual = {b["id"] for b in bridge.SEED_BACKENDS}
        missing = EXPECTED_BACKEND_IDS - actual
        assert not missing, f"Missing required backends: {missing}"

    def test_no_forbidden_backends(self, bridge):
        actual = {b["id"] for b in bridge.SEED_BACKENDS}
        leaked = FORBIDDEN_BACKEND_IDS & actual
        assert not leaked, (
            f"AWS/ServiceNow MCPs are embedded in their agent containers and "
            f"must not be seeded as standalone gateway backends: {leaked}"
        )

    def test_every_backend_has_required_fields(self, bridge):
        for b in bridge.SEED_BACKENDS:
            assert b.get("id"), f"Backend missing id: {b!r}"
            assert b.get("upstream_url"), f"Backend missing upstream_url: {b!r}"
            assert b.get("upstream_url", "").startswith("http://"), (
                f"Backend upstream_url must be http:// (cluster-local): {b!r}"
            )
            assert b.get("enabled") is True, f"Backend disabled in seed: {b!r}"

    def test_backend_ids_are_unique(self, bridge):
        ids = [b["id"] for b in bridge.SEED_BACKENDS]
        assert len(ids) == len(set(ids)), f"Duplicate backend ids: {ids}"


class TestSeedPolicies:
    def test_every_backend_has_at_least_one_invoke_policy(self, bridge):
        backend_ids = {b["id"] for b in bridge.SEED_BACKENDS}
        policy_backend_ids = {p["backend_id"] for p in bridge.SEED_POLICIES}
        uncovered = backend_ids - policy_backend_ids
        assert not uncovered, (
            f"Backends with no invoke policy (would be deny-all by default): "
            f"{uncovered}"
        )

    def test_every_policy_targets_a_known_backend(self, bridge):
        backend_ids = {b["id"] for b in bridge.SEED_BACKENDS}
        for p in bridge.SEED_POLICIES:
            assert p["backend_id"] in backend_ids, (
                f"Policy targets unknown backend: {p!r}"
            )

    def test_every_policy_has_required_fields(self, bridge):
        for p in bridge.SEED_POLICIES:
            assert "backend_id" in p
            assert "tool_pattern" in p  # may be empty (= match all tools)
            assert p.get("expression"), f"Policy missing expression: {p!r}"
            assert p.get("description"), f"Policy missing description: {p!r}"
            assert p.get("enabled") is True, f"Policy disabled in seed: {p!r}"

    def test_policy_expressions_only_reference_realm_roles(self, bridge):
        # CEL guard: every policy must gate on jwt.realm_access.roles. This
        # prevents accidentally shipping a "true"-only rule that opens a
        # backend to anonymous traffic.
        for p in bridge.SEED_POLICIES:
            assert "jwt.realm_access.roles" in p["expression"], (
                f"Policy must gate on jwt.realm_access.roles: {p!r}"
            )


class TestSeedingIdempotency:
    """The bridge must add new seeds without overwriting operator edits."""

    def test_seed_collections_only_inserts_missing(self, bridge):
        inserts: list[dict] = []

        class FakeCol:
            def __init__(self, existing_ids: set[str], key_field: str):
                self._existing = existing_ids
                self._key = key_field

            def find_one(self, query: dict):
                # Two key shapes: backend_id+tool_pattern (policies) OR id (backends)
                if "id" in query:
                    return {"_id": "x"} if query["id"] in self._existing else None
                key = (query.get("backend_id"), query.get("tool_pattern"))
                return {"_id": "x"} if key in self._existing else None

            def insert_one(self, doc: dict):
                inserts.append({"col": self._key, "doc": doc})

        existing_policies = {("rag", "rag_query")}  # operator already has this one
        existing_backends = {"rag"}  # operator already configured rag

        class FakeDB:
            def __getitem__(self, name):
                if name == "ag_mcp_policies":
                    return FakeCol(existing_policies, "policies")
                if name == "ag_mcp_backends":
                    return FakeCol(existing_backends, "backends")
                raise KeyError(name)

        bridge.seed_collections(FakeDB())

        inserted_backend_ids = {
            i["doc"]["id"] for i in inserts if i["col"] == "backends"
        }
        # rag was pre-existing; everything else must have been inserted
        assert "rag" not in inserted_backend_ids
        assert "mcp_jira" in inserted_backend_ids
        assert "mcp_komodor" in inserted_backend_ids

        # rag_query policy was pre-existing; must NOT be re-inserted
        inserted_policy_keys = {
            (i["doc"]["backend_id"], i["doc"]["tool_pattern"])
            for i in inserts
            if i["col"] == "policies"
        }
        assert ("rag", "rag_query") not in inserted_policy_keys
