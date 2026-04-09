# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Distributed A2A binding: routing and env parsing edge cases.

Baseline parsing and ``_agent_is_distributed`` unit tests live in
``tests/test_distributed_agents.py``. This module adds per-agent routing
coverage and parsing edge cases not duplicated there.
"""

from __future__ import annotations

import os
from unittest.mock import patch

from ai_platform_engineering.multi_agents.platform_engineer.deep_agent import (
    _agent_is_distributed,
    _get_distributed_agents,
    _is_agent_enabled,
    _ALL_SENTINEL,
    SINGLE_NODE_AGENTS,
)


def _enabled_agent_routing() -> tuple[list[str], list[str]]:
    """Mirror ``_create_subagent_defs`` routing for enabled single-node agents."""
    distributed = _get_distributed_agents()
    remote: list[str] = []
    local: list[str] = []
    for name, _ in SINGLE_NODE_AGENTS:
        if not _is_agent_enabled(name):
            continue
        if _agent_is_distributed(name, distributed):
            remote.append(name)
        else:
            local.append(name)
    return remote, local


class TestDistributedAgentsParsing:
    """Edge cases for ``_get_distributed_agents()`` (see also test_distributed_agents.py)."""

    def test_all_keyword_with_extra_tokens_still_all_sentinel(self) -> None:
        """``all`` anywhere in the token set forces remote routing for every agent."""
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": "all,argocd"}, clear=False):
            assert _get_distributed_agents() == {_ALL_SENTINEL}

    def test_mixed_case_all_with_extra_tokens(self) -> None:
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": "ArGoC,ALL,aws"}, clear=False):
            assert _get_distributed_agents() == {_ALL_SENTINEL}

    def test_very_long_agent_list_parsing(self) -> None:
        names = [f"agent{i}" for i in range(200)]
        raw = ",".join(names)
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": raw}, clear=False):
            assert _get_distributed_agents() == set(names)


class TestAgentIsDistributed:
    """Binding checks for GitHub name + sentinel (full matrix in test_distributed_agents.py)."""

    def test_github_with_explicit_all_sentinel(self) -> None:
        assert _agent_is_distributed("github", {_ALL_SENTINEL}) is True

    def test_github_with_named_set(self) -> None:
        assert _agent_is_distributed("github", {"argocd", "aws"}) is False
        assert _agent_is_distributed("github", {"github"}) is True


class TestDistributedModeRouting:
    """Per-agent routing: ``_get_distributed_agents`` + ``_agent_is_distributed``."""

    def test_argocd_distributed_others_local(self) -> None:
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": "argocd"}, clear=False):
            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.DISTRIBUTED_MODE",
                False,
            ):
                d = _get_distributed_agents()
        assert _agent_is_distributed("argocd", d) is True
        assert _agent_is_distributed("github", d) is False

    def test_all_distributed(self) -> None:
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": "all"}, clear=False):
            d = _get_distributed_agents()
        assert d == {_ALL_SENTINEL}
        assert _agent_is_distributed("github", d) is True
        assert _agent_is_distributed("argocd", d) is True

    def test_none_distributed(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DISTRIBUTED_AGENTS", None)
            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.DISTRIBUTED_MODE",
                False,
            ):
                d = _get_distributed_agents()
        assert d == set()
        assert _agent_is_distributed("github", d) is False
        assert _agent_is_distributed("argocd", d) is False

    def test_enable_github_false_skips_github_even_if_distributed_list(self) -> None:
        """Disabled agents are omitted before remote/local split (matches deep_agent)."""
        extras = {
            "DISTRIBUTED_AGENTS": "github,argocd",
            "ENABLE_GITHUB": "false",
        }
        with patch.dict(os.environ, extras, clear=False):
            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.DISTRIBUTED_MODE",
                False,
            ):
                assert _is_agent_enabled("github") is False
                assert _is_agent_enabled("argocd") is True
                remote, local = _enabled_agent_routing()
        assert "github" not in remote
        assert "github" not in local
        assert "argocd" in remote
