# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Tests for per-agent distribution control via DISTRIBUTED_AGENTS env var."""

import os
from unittest.mock import patch

import pytest

from ai_platform_engineering.multi_agents.platform_engineer.deep_agent import (
    _get_distributed_agents,
    _agent_is_distributed,
    _ALL_SENTINEL,
)


class TestGetDistributedAgents:
    """Tests for _get_distributed_agents() env var parsing."""

    def test_unset_returns_empty(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DISTRIBUTED_AGENTS", None)
            os.environ.pop("DISTRIBUTED_MODE", None)
            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.DISTRIBUTED_MODE",
                False,
            ):
                result = _get_distributed_agents()
                assert result == set()

    def test_empty_string_returns_empty(self):
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": ""}, clear=False):
            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.DISTRIBUTED_MODE",
                False,
            ):
                result = _get_distributed_agents()
                assert result == set()

    def test_single_agent(self):
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": "argocd"}, clear=False):
            result = _get_distributed_agents()
            assert result == {"argocd"}

    def test_multiple_agents(self):
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": "argocd,aws,jira"}, clear=False):
            result = _get_distributed_agents()
            assert result == {"argocd", "aws", "jira"}

    def test_all_keyword(self):
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": "all"}, clear=False):
            result = _get_distributed_agents()
            assert result == {_ALL_SENTINEL}

    def test_all_mixed_case(self):
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": "ALL"}, clear=False):
            result = _get_distributed_agents()
            assert result == {_ALL_SENTINEL}

    def test_case_insensitive(self):
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": "ArgoCD,AWS"}, clear=False):
            result = _get_distributed_agents()
            assert result == {"argocd", "aws"}

    def test_whitespace_trimmed(self):
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": " argocd , aws "}, clear=False):
            result = _get_distributed_agents()
            assert result == {"argocd", "aws"}

    def test_empty_tokens_ignored(self):
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": "argocd,,aws,"}, clear=False):
            result = _get_distributed_agents()
            assert result == {"argocd", "aws"}

    def test_legacy_distributed_mode_true_returns_all(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DISTRIBUTED_AGENTS", None)
            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.DISTRIBUTED_MODE",
                True,
            ):
                result = _get_distributed_agents()
                assert result == {_ALL_SENTINEL}

    def test_distributed_agents_takes_precedence_over_distributed_mode(self):
        """DISTRIBUTED_AGENTS overrides DISTRIBUTED_MODE when both are set."""
        with patch.dict(os.environ, {"DISTRIBUTED_AGENTS": "argocd"}, clear=False):
            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.DISTRIBUTED_MODE",
                True,
            ):
                result = _get_distributed_agents()
                assert result == {"argocd"}


class TestAgentIsDistributed:
    """Tests for _agent_is_distributed() routing logic."""

    def test_agent_in_set(self):
        assert _agent_is_distributed("argocd", {"argocd", "aws"}) is True

    def test_agent_not_in_set(self):
        assert _agent_is_distributed("jira", {"argocd", "aws"}) is False

    def test_all_sentinel_matches_any(self):
        assert _agent_is_distributed("jira", {_ALL_SENTINEL}) is True
        assert _agent_is_distributed("argocd", {_ALL_SENTINEL}) is True

    def test_empty_set_matches_none(self):
        assert _agent_is_distributed("argocd", set()) is False

    def test_case_sensitive_match(self):
        assert _agent_is_distributed("argocd", {"argocd"}) is True
        assert _agent_is_distributed("ArgoCD", {"argocd"}) is False
