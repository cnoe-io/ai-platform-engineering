"""Autonomous chat runs must pass the can_schedule gate in addition to can_use
(spec 2026-07-01). Interactive runs must NOT trigger the schedule check."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from dynamic_agents.routes import chat as chat_routes


@pytest.mark.asyncio
async def test_autonomous_run_requires_schedule(monkeypatch):
    calls = {"use": False, "schedule": False}

    async def fake_use(agent_id, delegated_user_sub=None):
        calls["use"] = True

    async def fake_schedule(agent_id, delegated_user_sub=None):
        calls["schedule"] = True
        raise HTTPException(status_code=403, detail={"code": "agent#schedule"})

    monkeypatch.setattr(chat_routes, "require_agent_use_permission", fake_use)
    monkeypatch.setattr(chat_routes, "require_agent_schedule_permission", fake_schedule)

    with pytest.raises(HTTPException) as exc:
        await chat_routes._enforce_chat_authz(agent_id="agent-x", user_sub="owner-1", autonomous=True)
    assert exc.value.status_code == 403
    assert calls == {"use": True, "schedule": True}


@pytest.mark.asyncio
async def test_interactive_run_skips_schedule(monkeypatch):
    calls = {"use": False, "schedule": False}

    async def fake_use(agent_id, delegated_user_sub=None):
        calls["use"] = True

    async def fake_schedule(agent_id, delegated_user_sub=None):
        calls["schedule"] = True

    monkeypatch.setattr(chat_routes, "require_agent_use_permission", fake_use)
    monkeypatch.setattr(chat_routes, "require_agent_schedule_permission", fake_schedule)

    await chat_routes._enforce_chat_authz(agent_id="agent-x", user_sub="u-1", autonomous=False)
    assert calls == {"use": True, "schedule": False}
