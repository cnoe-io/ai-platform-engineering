# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tool-level tests for get_api_reporting_v2_incidents.

Covers behavior the wrapper adds on top of the upstream call:
- Pretty-printed (multi-line) JSON string so grep/glob over the tool result work.
- total_count_by_phase summary computed from the merged set.
- all_orgs=True fan-out: concurrent calls + per-org partial-failure surfacing.
- Filter/window params (startedAfter, currentPhase, routingKey, etc.) reach the upstream call.
"""

import importlib
import json
import os

import pytest


def _reload_tool(env_overrides: dict[str, str | None]):
    """Reload the v2-reporting incidents tool with env overrides."""
    original = {}
    for key, value in env_overrides.items():
        original[key] = os.environ.get(key)
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value

    try:
        import mcp_victorops.api.client as client_mod
        importlib.reload(client_mod)
        import mcp_victorops.tools.api_reporting_v2_incidents as tool_mod
        importlib.reload(tool_mod)
        return tool_mod, client_mod
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _bulky_response(org_label: str, count: int = 5):
    return {
        "incidents": [
            {
                "incidentNumber": f"{org_label}-{n}",
                "currentPhase": "triggered" if n % 2 == 0 else "resolved",
                "entityId": f"host-{n}",
                "host": f"host-{n}",
                "service": "svc",
                "routingKey": "platform-sre" if n % 2 == 0 else "ops",
                "startTime": "2026-05-08T10:00:00Z",
                "alertCount": 3,
                "alerts": [{"id": f"a-{n}-{j}", "huge": "x" * 5000} for j in range(3)],
                "transitions": [{"foo": "bar"} for _ in range(20)],
                "pagedUsers": [{"username": "alice"}],
                "pagedTeams": [{"slug": "team-sre"}],
            }
            for n in range(count)
        ],
        "total": count,
        "offset": 0,
        "limit": 20,
    }


@pytest.fixture
def two_org_env():
    return {
        "VICTOROPS_ORGS": json.dumps({
            "ssc": {"api_url": "https://ssc.example.com", "api_key": "k1", "api_id": "i1"},
            "other": {"api_url": "https://other.example.com", "api_key": "k2", "api_id": "i2"},
        }),
        "VICTOROPS_API_URL": None,
        "X_VO_API_KEY": None,
        "X_VO_API_ID": None,
    }


class TestSummary:
    @pytest.mark.asyncio
    async def test_total_count_by_phase_summary_present(self, two_org_env, monkeypatch):
        tool_mod, _ = _reload_tool(two_org_env)

        async def fake_request(path, method="GET", org_slug=None, params=None, data=None, timeout=30):
            return (True, _bulky_response("ssc", count=4))

        monkeypatch.setattr(tool_mod, "make_api_request", fake_request)
        result = await tool_mod.get_api_reporting_v2_incidents(org_slug="ssc")
        parsed = json.loads(result)
        assert parsed["total_count_by_phase"] == {"triggered": 2, "resolved": 2}
        assert parsed["total_count"] == 4


class TestMultilineString:
    @pytest.mark.asyncio
    async def test_returns_string_with_newlines(self, two_org_env, monkeypatch):
        tool_mod, _ = _reload_tool(two_org_env)

        async def fake_request(path, method="GET", org_slug=None, params=None, data=None, timeout=30):
            return (True, _bulky_response("ssc", count=2))

        monkeypatch.setattr(tool_mod, "make_api_request", fake_request)
        result = await tool_mod.get_api_reporting_v2_incidents(org_slug="ssc")

        assert isinstance(result, str), "must return str so FastMCP doesn't recompact"
        assert result.count("\n") > 20, (
            f"output must be multi-line for grep to work; got {result.count(chr(10))} newlines"
        )
        parsed = json.loads(result)
        assert "incidents" in parsed


class TestAllOrgsFanOut:
    @pytest.mark.asyncio
    async def test_all_orgs_returns_results_keyed_by_slug(self, two_org_env, monkeypatch):
        tool_mod, _ = _reload_tool(two_org_env)

        async def fake_request(path, method="GET", org_slug=None, params=None, data=None, timeout=30):
            return (True, _bulky_response(org_slug, count=2))

        monkeypatch.setattr(tool_mod, "make_api_request", fake_request)
        result = await tool_mod.get_api_reporting_v2_incidents(all_orgs=True)
        parsed = json.loads(result)

        assert "by_org" in parsed, "all_orgs=True must return per-org breakdown"
        assert set(parsed["by_org"].keys()) == {"ssc", "other"}
        assert all(i["incidentNumber"].startswith("ssc-") for i in parsed["by_org"]["ssc"])
        assert all(i["incidentNumber"].startswith("other-") for i in parsed["by_org"]["other"])

    @pytest.mark.asyncio
    async def test_all_orgs_partial_failure_does_not_fail_whole_call(self, two_org_env, monkeypatch):
        tool_mod, _ = _reload_tool(two_org_env)

        async def fake_request(path, method="GET", org_slug=None, params=None, data=None, timeout=30):
            if org_slug == "other":
                return (False, {"error": "401 Unauthorized"})
            return (True, _bulky_response(org_slug, count=2))

        monkeypatch.setattr(tool_mod, "make_api_request", fake_request)
        result = await tool_mod.get_api_reporting_v2_incidents(all_orgs=True)
        parsed = json.loads(result)

        assert "ssc" in parsed["by_org"]
        assert "other" not in parsed["by_org"]
        assert parsed["errors"]["other"].startswith("401")

    @pytest.mark.asyncio
    async def test_all_orgs_with_org_slug_is_rejected(self, two_org_env, monkeypatch):
        tool_mod, _ = _reload_tool(two_org_env)

        async def fake_request(*a, **kw):
            raise AssertionError("must not call API when args conflict")
        monkeypatch.setattr(tool_mod, "make_api_request", fake_request)

        result = await tool_mod.get_api_reporting_v2_incidents(org_slug="ssc", all_orgs=True)
        parsed = json.loads(result)
        assert "error" in parsed


class TestFilterParamsForwarded:
    """The agent prompt requires startedAfter + currentPhase on every call.
    Make sure those land in the query string."""

    @pytest.mark.asyncio
    async def test_started_after_and_phase_passed_through(self, two_org_env, monkeypatch):
        tool_mod, _ = _reload_tool(two_org_env)

        captured: dict = {}

        async def fake_request(path, method="GET", org_slug=None, params=None, data=None, timeout=30):
            captured["params"] = dict(params or {})
            return (True, _bulky_response("ssc", count=1))

        monkeypatch.setattr(tool_mod, "make_api_request", fake_request)

        await tool_mod.get_api_reporting_v2_incidents(
            org_slug="ssc",
            startedAfter="2026-05-08T08:00:00Z",
            currentPhase="triggered,acknowledged,resolved",
            routingKey="platform-sre",
            limit=10,
        )

        assert captured["params"]["startedAfter"] == "2026-05-08T08:00:00Z"
        assert captured["params"]["currentPhase"] == "triggered,acknowledged,resolved"
        assert captured["params"]["routingKey"] == "platform-sre"
        assert captured["params"]["limit"] == 10
