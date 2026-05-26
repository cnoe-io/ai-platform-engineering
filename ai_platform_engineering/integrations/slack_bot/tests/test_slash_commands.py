"""Tests for the /caipe-list, /caipe-use, /caipe-help slash command handlers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from ai_platform_engineering.integrations.slack_bot.utils.accessible_agents_client import (
    AccessibleAgent,
    AccessibleAgentsResult,
)
from ai_platform_engineering.integrations.slack_bot.utils.command_rate_limiter import (
    CommandRateLimiter,
)
from ai_platform_engineering.integrations.slack_bot.utils.dm_authz_client import (
    DmAgentAccessDecision,
)
from ai_platform_engineering.integrations.slack_bot.utils.dm_thread_overrides import (
    OverrideKey,
    OverrideStore,
)
from ai_platform_engineering.integrations.slack_bot.utils.slash_commands import (
    HELP_MESSAGE,
    LIST_EMPTY_MESSAGE,
    LIST_HEADER,
    LIST_UNAVAILABLE_MESSAGE,
    PDP_UNAVAILABLE_MESSAGE,
    RATE_LIMITED_MESSAGE,
    USE_DEFAULT_OK_MESSAGE,
    USE_DEFAULT_PARTIAL_OK_MESSAGE,
    USE_DENIED_MESSAGE,
    USE_DM_ONLY_MESSAGE,
    USE_MISSING_ARG_MESSAGE,
    USE_OK_MESSAGE,
    USE_UNKNOWN_AGENT_MESSAGE,
    handle_help_command,
    handle_list_command,
    handle_use_command,
)


class _Clock:
    def __init__(self) -> None:
        self._now = 100.0

    def __call__(self) -> float:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += seconds


@dataclass
class _FakeAccessibleAgentsClient:
    result: AccessibleAgentsResult
    calls: int = 0

    def list_agents(
        self, *, bearer_token: str, page_size: int = 25
    ) -> AccessibleAgentsResult:
        self.calls += 1
        return self.result


@dataclass
class _FakeDmAuthzClient:
    decisions: List[DmAgentAccessDecision] = field(default_factory=list)
    calls: List[tuple] = field(default_factory=list)

    def check_agent_access(
        self, *, bearer_token: str, agent_id: str
    ) -> DmAgentAccessDecision:
        self.calls.append((bearer_token, agent_id))
        if not self.decisions:
            raise RuntimeError("no fake decision configured")
        return self.decisions.pop(0)


@dataclass
class _FakeUserPreferencesClient:
    clear_result: bool = True
    clear_calls: List[str] = field(default_factory=list)

    def clear_dm_default_agent(self, *, bearer_token: str) -> bool:
        self.clear_calls.append(bearer_token)
        return self.clear_result


def _allowed(agent_id: str) -> DmAgentAccessDecision:
    return DmAgentAccessDecision(
        allowed=True,
        reason="ALLOWED",
        path=f"direct:user→agent({agent_id})",
        available=True,
        matched_team_slug=None,
    )


def _denied(agent_id: str) -> DmAgentAccessDecision:
    return DmAgentAccessDecision(
        allowed=False,
        reason="NOT_ALLOWED",
        path="",
        available=True,
        matched_team_slug=None,
    )


def _pdp_unavailable() -> DmAgentAccessDecision:
    return DmAgentAccessDecision(
        allowed=False,
        reason="PDP_UNAVAILABLE",
        path="",
        available=False,
        matched_team_slug=None,
    )


def _override_key() -> OverrideKey:
    return OverrideKey(
        workspace_id="T1",
        channel_id="D1",
        user_id="U1",
        thread_ts="1700000000.000100",
    )


# ---------- help -----------------------------------------------------------


def test_help_returns_help_text() -> None:
    result = handle_help_command(user_key="U1")
    assert result.code == "help"
    assert result.text == HELP_MESSAGE


def test_help_is_rate_limited() -> None:
    clock = _Clock()
    limiter = CommandRateLimiter(
        max_per_window=1, window_seconds=10.0, time_source=clock
    )
    first = handle_help_command(user_key="U1", rate_limiter=limiter)
    second = handle_help_command(user_key="U1", rate_limiter=limiter)
    assert first.code == "help"
    assert second.code == "rate_limited"
    assert second.text == RATE_LIMITED_MESSAGE


# ---------- list -----------------------------------------------------------


def test_list_returns_formatted_agents() -> None:
    fake_client = _FakeAccessibleAgentsClient(
        result=AccessibleAgentsResult(
            agents=[
                AccessibleAgent(id="github", name="GitHub", description="Git ops"),
                AccessibleAgent(id="jira", name="Jira", description=""),
            ],
            available=True,
        )
    )
    result = handle_list_command(
        user_key="U1",
        bearer_token="tok",
        accessible_agents_client=fake_client,
    )
    assert result.code == "list_ok"
    assert LIST_HEADER.format(count=2).splitlines()[0] in result.text
    assert "`github`" in result.text
    assert "Git ops" in result.text
    assert "`jira`" in result.text


def test_list_handles_empty_list() -> None:
    fake_client = _FakeAccessibleAgentsClient(
        result=AccessibleAgentsResult(agents=[], available=True)
    )
    result = handle_list_command(
        user_key="U1",
        bearer_token="tok",
        accessible_agents_client=fake_client,
    )
    assert result.code == "list_empty"
    assert result.text == LIST_EMPTY_MESSAGE


def test_list_unavailable_is_friendly() -> None:
    fake_client = _FakeAccessibleAgentsClient(
        result=AccessibleAgentsResult(agents=[], available=False)
    )
    result = handle_list_command(
        user_key="U1",
        bearer_token="tok",
        accessible_agents_client=fake_client,
    )
    assert result.code == "list_unavailable"
    assert result.text == LIST_UNAVAILABLE_MESSAGE


def test_list_respects_rate_limit() -> None:
    clock = _Clock()
    limiter = CommandRateLimiter(
        max_per_window=1, window_seconds=10.0, time_source=clock
    )
    fake_client = _FakeAccessibleAgentsClient(
        result=AccessibleAgentsResult(
            agents=[AccessibleAgent(id="x", name="X", description="")],
            available=True,
        )
    )
    first = handle_list_command(
        user_key="U1",
        bearer_token="tok",
        accessible_agents_client=fake_client,
        rate_limiter=limiter,
    )
    second = handle_list_command(
        user_key="U1",
        bearer_token="tok",
        accessible_agents_client=fake_client,
        rate_limiter=limiter,
    )
    assert first.code == "list_ok"
    assert second.code == "rate_limited"
    assert fake_client.calls == 1


# ---------- use ------------------------------------------------------------


def test_use_missing_arg() -> None:
    store = OverrideStore()
    result = handle_use_command(
        user_key="U1",
        raw_text="   ",
        bearer_token="tok",
        is_dm=True,
        override_key=_override_key(),
        override_store=store,
        dm_authz_client=_FakeDmAuthzClient(),
        user_preferences_client=_FakeUserPreferencesClient(),
    )
    assert result.code == "use_missing_arg"
    assert result.text == USE_MISSING_ARG_MESSAGE


def test_use_outside_dm_is_refused() -> None:
    store = OverrideStore()
    result = handle_use_command(
        user_key="U1",
        raw_text="github",
        bearer_token="tok",
        is_dm=False,
        override_key=None,
        override_store=store,
        dm_authz_client=_FakeDmAuthzClient(),
        user_preferences_client=_FakeUserPreferencesClient(),
    )
    assert result.code == "use_dm_only"
    assert result.text == USE_DM_ONLY_MESSAGE


def test_use_allowed_sets_override() -> None:
    store = OverrideStore()
    key = _override_key()
    result = handle_use_command(
        user_key="U1",
        raw_text="github",
        bearer_token="tok",
        is_dm=True,
        override_key=key,
        override_store=store,
        dm_authz_client=_FakeDmAuthzClient(decisions=[_allowed("github")]),
        user_preferences_client=_FakeUserPreferencesClient(),
    )
    assert result.code == "use_ok"
    assert result.text == USE_OK_MESSAGE.format(agent_id="github")
    assert store.get(key) == "github"


def test_use_denied_known_agent() -> None:
    store = OverrideStore()
    key = _override_key()
    fake_list = _FakeAccessibleAgentsClient(
        result=AccessibleAgentsResult(
            agents=[AccessibleAgent(id="github", name="GitHub", description="")],
            available=True,
        )
    )
    result = handle_use_command(
        user_key="U1",
        raw_text="github",
        bearer_token="tok",
        is_dm=True,
        override_key=key,
        override_store=store,
        dm_authz_client=_FakeDmAuthzClient(decisions=[_denied("github")]),
        user_preferences_client=_FakeUserPreferencesClient(),
        accessible_agents_client=fake_list,
    )
    assert result.code == "use_denied"
    assert result.text == USE_DENIED_MESSAGE.format(agent_id="github")
    assert store.get(key) is None


def test_use_denied_unknown_agent_is_friendly() -> None:
    store = OverrideStore()
    key = _override_key()
    fake_list = _FakeAccessibleAgentsClient(
        result=AccessibleAgentsResult(
            agents=[AccessibleAgent(id="github", name="GitHub", description="")],
            available=True,
        )
    )
    result = handle_use_command(
        user_key="U1",
        raw_text="github-agent",
        bearer_token="tok",
        is_dm=True,
        override_key=key,
        override_store=store,
        dm_authz_client=_FakeDmAuthzClient(decisions=[_denied("github-agent")]),
        user_preferences_client=_FakeUserPreferencesClient(),
        accessible_agents_client=fake_list,
    )
    assert result.code == "use_unknown"
    assert result.text == USE_UNKNOWN_AGENT_MESSAGE.format(agent_id="github-agent")


def test_use_pdp_unavailable() -> None:
    store = OverrideStore()
    key = _override_key()
    result = handle_use_command(
        user_key="U1",
        raw_text="github",
        bearer_token="tok",
        is_dm=True,
        override_key=key,
        override_store=store,
        dm_authz_client=_FakeDmAuthzClient(decisions=[_pdp_unavailable()]),
        user_preferences_client=_FakeUserPreferencesClient(),
    )
    assert result.code == "pdp_unavailable"
    assert result.text == PDP_UNAVAILABLE_MESSAGE
    assert store.get(key) is None


def test_use_default_clears_override_and_preference() -> None:
    store = OverrideStore()
    key = _override_key()
    store.set(key, "github")
    prefs = _FakeUserPreferencesClient(clear_result=True)
    result = handle_use_command(
        user_key="U1",
        raw_text="default",
        bearer_token="tok",
        is_dm=True,
        override_key=key,
        override_store=store,
        dm_authz_client=_FakeDmAuthzClient(),
        user_preferences_client=prefs,
    )
    assert result.code == "use_default_ok"
    assert result.text == USE_DEFAULT_OK_MESSAGE
    assert store.get(key) is None
    assert prefs.clear_calls == ["tok"]


def test_use_default_partial_when_preference_clear_fails() -> None:
    store = OverrideStore()
    key = _override_key()
    store.set(key, "github")
    prefs = _FakeUserPreferencesClient(clear_result=False)
    result = handle_use_command(
        user_key="U1",
        raw_text="DEFAULT",
        bearer_token="tok",
        is_dm=True,
        override_key=key,
        override_store=store,
        dm_authz_client=_FakeDmAuthzClient(),
        user_preferences_client=prefs,
    )
    assert result.code == "use_default_partial"
    assert result.text == USE_DEFAULT_PARTIAL_OK_MESSAGE
    assert store.get(key) is None


def test_use_default_outside_dm_still_clears_preference() -> None:
    """FR-029a: ``default`` always succeeds at clearing the user's
    own preference; permission checks don't apply to clearing your
    own state."""
    store = OverrideStore()
    prefs = _FakeUserPreferencesClient(clear_result=True)
    result = handle_use_command(
        user_key="U1",
        raw_text="default",
        bearer_token="tok",
        is_dm=False,
        override_key=None,
        override_store=store,
        dm_authz_client=_FakeDmAuthzClient(),
        user_preferences_client=prefs,
    )
    assert result.code == "use_default_ok"
    assert prefs.clear_calls == ["tok"]


def test_use_is_rate_limited() -> None:
    clock = _Clock()
    limiter = CommandRateLimiter(
        max_per_window=1, window_seconds=10.0, time_source=clock
    )
    store = OverrideStore()
    key = _override_key()
    first = handle_use_command(
        user_key="U1",
        raw_text="github",
        bearer_token="tok",
        is_dm=True,
        override_key=key,
        override_store=store,
        dm_authz_client=_FakeDmAuthzClient(decisions=[_allowed("github")]),
        user_preferences_client=_FakeUserPreferencesClient(),
        rate_limiter=limiter,
    )
    second = handle_use_command(
        user_key="U1",
        raw_text="github",
        bearer_token="tok",
        is_dm=True,
        override_key=key,
        override_store=store,
        dm_authz_client=_FakeDmAuthzClient(decisions=[_allowed("github")]),
        user_preferences_client=_FakeUserPreferencesClient(),
        rate_limiter=limiter,
    )
    assert first.code == "use_ok"
    assert second.code == "rate_limited"
