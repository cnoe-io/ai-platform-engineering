# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tool-level tests for team / user / schedule endpoints.

Covers behavior the wrappers add on top of the upstream call:
- Pretty-printed (multi-line) JSON string so grep/glob over the tool result work.
- Top-level list → dict wrap (so FastMCP's structured_content validation accepts it).
"""

import importlib
import json
import os

import pytest


def _reload(env_overrides: dict[str, str | None]):
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
        import mcp_victorops.utils.cache as cache_mod
        importlib.reload(cache_mod)
        import mcp_victorops.tools.api_public_v1_team as team_mod
        import mcp_victorops.tools.api_public_v2_user as user_mod
        import mcp_victorops.tools.api_public_v2_team_oncall as schedule_mod
        importlib.reload(team_mod)
        importlib.reload(user_mod)
        importlib.reload(schedule_mod)
        return team_mod, user_mod, schedule_mod
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


@pytest.fixture
def single_org_env():
    return {
        "VICTOROPS_API_URL": "https://example.com",
        "X_VO_API_KEY": "k",
        "X_VO_API_ID": "i",
        "VICTOROPS_ORGS": None,
        "VICTOROPS_CACHE_TTL_TEAMS_SECONDS": "0",
        "VICTOROPS_CACHE_TTL_USERS_SECONDS": "0",
        "VICTOROPS_CACHE_TTL_SCHEDULES_SECONDS": "0",
    }


def _bulky_teams(count: int = 50):
    return [
        {
            "_selfUrl": f"/api-public/v1/team/team-{n}",
            "_membersUrl": f"/api-public/v1/team/team-{n}/members",
            "name": f"Team {n}",
            "slug": f"team-{n}",
            "memberCount": n,
            "version": n * 3,
        }
        for n in range(count)
    ]


class TestTeamOutput:
    @pytest.mark.asyncio
    async def test_returns_multiline_string(self, single_org_env, monkeypatch):
        team_mod, _, _ = _reload(single_org_env)

        async def fake_request(path, method="GET", org_slug=None, params=None, data=None, timeout=30):
            return (True, _bulky_teams(20))

        monkeypatch.setattr(team_mod, "make_api_request", fake_request)
        result = await team_mod.get_api_public_v1_team()

        assert isinstance(result, str), "tool must return str so FastMCP doesn't recompact"
        assert result.count("\n") > 50, (
            f"output must be multi-line for grep to work; got {result.count(chr(10))} newlines"
        )
        parsed = json.loads(result)
        assert "teams" in parsed and isinstance(parsed["teams"], list)


class TestUserOutput:
    @pytest.mark.asyncio
    async def test_returns_multiline_string(self, single_org_env, monkeypatch):
        _, user_mod, _ = _reload(single_org_env)

        async def fake_request(path, method="GET", org_slug=None, params=None, data=None, timeout=30):
            return (True, [{"username": f"u{n}", "email": f"u{n}@x.com"} for n in range(10)])

        monkeypatch.setattr(user_mod, "make_api_request", fake_request)
        result = await user_mod.get_api_public_v2_user()

        assert isinstance(result, str)
        assert result.count("\n") > 20


class TestScheduleOutput:
    @pytest.mark.asyncio
    async def test_returns_multiline_string(self, single_org_env, monkeypatch):
        _, _, schedule_mod = _reload(single_org_env)

        upstream = {
            "teamSchedules": [
                {"policy": {"name": "p"}, "schedule": [{"rotationName": "r", "onCallNow": []}]},
            ],
        }

        async def fake_request(path, method="GET", org_slug=None, params=None, data=None, timeout=30):
            return (True, upstream)

        monkeypatch.setattr(schedule_mod, "make_api_request", fake_request)
        result = await schedule_mod.get_api_public_v2_team_oncall_schedule(team="team-x")

        assert isinstance(result, str)
        assert result.count("\n") > 5


class TestListWrapping:
    """Top-level lists must be wrapped into a dict before serialization."""

    @pytest.mark.asyncio
    async def test_team_wraps_top_level_list(self, single_org_env, monkeypatch):
        team_mod, _, _ = _reload(single_org_env)

        async def fake_request(path, method="GET", org_slug=None, params=None, data=None, timeout=30):
            return (True, _bulky_teams(2))

        monkeypatch.setattr(team_mod, "make_api_request", fake_request)
        result = await team_mod.get_api_public_v1_team()
        assert isinstance(result, str)
        parsed = json.loads(result)
        assert isinstance(parsed, dict)
        assert "teams" in parsed

    @pytest.mark.asyncio
    async def test_user_wraps_top_level_list(self, single_org_env, monkeypatch):
        _, user_mod, _ = _reload(single_org_env)

        async def fake_request(path, method="GET", org_slug=None, params=None, data=None, timeout=30):
            return (True, [{"username": "alice"}])

        monkeypatch.setattr(user_mod, "make_api_request", fake_request)
        result = await user_mod.get_api_public_v2_user()
        assert isinstance(result, str)
        parsed = json.loads(result)
        assert isinstance(parsed, dict)
        assert "users" in parsed
