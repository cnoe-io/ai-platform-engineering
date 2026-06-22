# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Tests for PolicyMiddleware.

Run with: python -m pytest tests/test_policy_middleware.py -v
Or directly: python tests/test_policy_middleware.py
"""

import os
import sys
from pathlib import Path
from unittest.mock import patch


# Add project root to path
sys.path.insert(0, str(Path(__file__).parents[1]))

_GITHUB_SUBAGENT_POLICY_LP = str(
    Path(__file__).resolve().parent / "fixtures" / "policy_github_subagent_test.lp"
)

from ai_platform_engineering.utils.deepagents_custom.policy_middleware import (
    PolicyMiddleware,
    CLORM_AVAILABLE,
)

TEST_POLICY_PATH = str(Path(__file__).parent / "fixtures" / "test_policy.lp")


def test_clorm_available():
    """Test that clorm is available."""
    print(f"CLORM_AVAILABLE: {CLORM_AVAILABLE}")
    if not CLORM_AVAILABLE:
        print("WARNING: Clorm is not installed. PolicyMiddleware will allow all tool calls.")
        print("Install with: pip install clorm")
    assert CLORM_AVAILABLE, "Clorm must be installed for policy enforcement to work"


def test_policy_file_exists():
    """Test that the test policy file exists."""
    assert os.path.exists(TEST_POLICY_PATH), f"Test policy file not found: {TEST_POLICY_PATH}"
    print(f"Test policy file exists: {TEST_POLICY_PATH}")


def test_readonly_tools_allowed_for_github():
    """Test that gh-backed GitHub tools are allowed for github subagent."""
    middleware = PolicyMiddleware(policy_path=TEST_POLICY_PATH, agent_name="github", agent_type="subagent")
    
    readonly_tools = ["gh_cli_execute", "get_file_contents"]
    
    for tool in readonly_tools:
        allowed = middleware._is_allowed(tool)
        print(f"  {tool}: {'✅ allowed' if allowed else '❌ denied'}")
        assert allowed, f"GitHub tool '{tool}' should be allowed for github agent"
    
    print(f"\n✅ All {len(readonly_tools)} gh-backed GitHub tools correctly allowed")


def test_write_tools_denied_for_github():
    """Test that removed GitHub MCP tools are denied for github subagent."""
    with patch(
        "ai_platform_engineering.utils.mongodb_client.get_policy_from_mongodb",
        return_value=None,
    ):
        middleware = PolicyMiddleware(
            agent_name="github",
            agent_type="subagent",
            policy_path=_GITHUB_SUBAGENT_POLICY_LP,
        )

        removed_mcp_tools = [
            "add_issue_comment",
            "assign_copilot_to_issue",
            "create_branch",
            "create_pull_request",
            "create_repository",
            "issue_write",
            "sub_issue_write",
            "add_comment_to_pending_review",
            "fork_repository",
            "merge_pull_request",
            "push_files",
            "pull_request_review_write",
            "request_copilot_review",
            "update_pull_request",
            "update_pull_request_branch",
            "delete_file",
        ]

        for tool in removed_mcp_tools:
            allowed = middleware._is_allowed(tool)
            print(f"  {tool}: {'❌ SHOULD BE DENIED but was allowed' if allowed else '✅ correctly denied'}")
            assert not allowed, f"Removed GitHub MCP tool '{tool}' should be DENIED for github agent"

        print(f"\n✅ All {len(removed_mcp_tools)} removed GitHub MCP tools correctly denied")


def test_removed_mcp_tools_denied_without_self_service_mode():
    """Test that removed GitHub MCP tools stay denied without self-service mode."""
    with patch(
        "ai_platform_engineering.utils.mongodb_client.get_policy_from_mongodb",
        return_value=None,
    ):
        middleware = PolicyMiddleware(
            agent_name="github",
            agent_type="subagent",
            policy_path=_GITHUB_SUBAGENT_POLICY_LP,
        )

        removed_tools = [
            "create_repository",
            "create_pull_request",
            "create_branch",
            "push_files",
            "fork_repository",
        ]

        for tool in removed_tools:
            allowed = middleware._is_allowed(tool)
            print(f"  {tool}: {'❌ SHOULD BE DENIED but was allowed' if allowed else '✅ correctly denied'}")
            assert not allowed, f"Removed GitHub MCP tool '{tool}' should be DENIED without self-service mode"

        allowed = middleware._is_allowed("create_or_update_file")
        assert not allowed, "create_or_update_file should be DENIED without self-service mode"

        print("\n✅ Removed GitHub MCP tools correctly denied without self-service mode")


def test_gh_backed_tools_allowed_with_self_service_mode():
    """Test that gh-backed GitHub tools remain policy-allowed in self-service mode."""
    from ai_platform_engineering.agents.github.agent_github.tools import self_service_mode_ctx

    with patch(
        "ai_platform_engineering.utils.mongodb_client.get_policy_from_mongodb",
        return_value=None,
    ):
        middleware = PolicyMiddleware(
            agent_name="github",
            agent_type="subagent",
            policy_path=_GITHUB_SUBAGENT_POLICY_LP,
        )
    
    gh_backed_tools = ["gh_cli_execute", "get_file_contents", "create_or_update_file"]
    
    # Set self-service mode
    token = self_service_mode_ctx.set(True)
    try:
        for tool in gh_backed_tools:
            allowed = middleware._is_allowed(tool)
            print(f"  {tool} (self_service=True): {'✅ allowed' if allowed else '❌ SHOULD BE ALLOWED but was denied'}")
            assert allowed, f"GitHub tool '{tool}' should be ALLOWED with self-service mode"
    finally:
        # Reset self-service mode
        self_service_mode_ctx.reset(token)
    
    print("\n✅ gh-backed GitHub tools correctly allowed with self-service mode")


def test_non_github_agents_allow_all():
    """Test that non-GitHub agents allow all tools."""
    non_github_agents = [
        "jira",
        "webex",
        "argocd",
        "backstage",
        "aigateway",
        "pagerduty",
        "slack",
        "splunk",
        "komodor",
        "confluence",
        "aws",
        "caipe",
    ]
    
    for agent in non_github_agents:
        middleware = PolicyMiddleware(policy_path=TEST_POLICY_PATH, agent_name=agent, agent_type="subagent")
        # Test a write tool that would be blocked for github
        allowed = middleware._is_allowed("create_pull_request")
        print(f"  {agent} agent - create_pull_request: {'✅ allowed' if allowed else '❌ denied'}")
        assert allowed, f"Non-GitHub agent '{agent}' should allow all tools"
    
    print(f"\n✅ All {len(non_github_agents)} non-GitHub agents correctly allow all tools")


def test_deep_agent_allows_all():
    """Test that deep_agent (supervisor) allows all tools."""
    middleware = PolicyMiddleware(policy_path=TEST_POLICY_PATH, agent_name="platform_engineer", agent_type="deep_agent")
    
    # Test tools that would be blocked for github subagent
    tools = ["create_pull_request", "delete_file", "merge_pull_request"]
    
    for tool in tools:
        allowed = middleware._is_allowed(tool)
        print(f"  {tool}: {'✅ allowed' if allowed else '❌ denied'}")
        assert allowed, f"Deep agent should allow all tools, but '{tool}' was denied"
    
    print("\n✅ Deep agent correctly allows all tools")


def test_builtin_tools_allowed():
    """Test that built-in deep agent tools are allowed."""
    middleware = PolicyMiddleware(policy_path=TEST_POLICY_PATH, agent_name="github", agent_type="subagent")
    
    builtin_tools = [
        "write_todos",
        "task",
        "read_file",
        "write_file",
        "ls",
        "grep",
        "glob",
        "edit_file",
        "tool_result_to_file",
        "wait",
        "invoke_self_service_task",
    ]
    
    for tool in builtin_tools:
        allowed = middleware._is_allowed(tool)
        print(f"  {tool}: {'✅ allowed' if allowed else '❌ denied'}")
        assert allowed, f"Built-in tool '{tool}' should be allowed"
    
    print(f"\n✅ All {len(builtin_tools)} built-in tools correctly allowed")


if __name__ == "__main__":
    print("=" * 60)
    print("PolicyMiddleware Tests")
    print("=" * 60)
    
    tests = [
        ("Clorm availability", test_clorm_available),
        ("Policy file exists", test_policy_file_exists),
        ("Read-only tools allowed for github", test_readonly_tools_allowed_for_github),
        ("Write tools denied for github", test_write_tools_denied_for_github),
        ("Removed MCP tools denied without mode", test_removed_mcp_tools_denied_without_self_service_mode),
        ("gh-backed tools allowed with mode", test_gh_backed_tools_allowed_with_self_service_mode),
        ("Non-GitHub agents allow all", test_non_github_agents_allow_all),
        ("Deep agent allows all", test_deep_agent_allows_all),
        ("Built-in tools allowed", test_builtin_tools_allowed),
    ]
    
    passed = 0
    failed = 0
    
    for name, test_func in tests:
        print(f"\n{'='*60}")
        print(f"Test: {name}")
        print("=" * 60)
        try:
            test_func()
            passed += 1
            print(f"\n✅ PASSED: {name}")
        except AssertionError as e:
            failed += 1
            print(f"\n❌ FAILED: {name}")
            print(f"   Error: {e}")
        except Exception as e:
            failed += 1
            print(f"\n❌ ERROR: {name}")
            print(f"   Exception: {type(e).__name__}: {e}")
    
    print("\n" + "=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)
    
    sys.exit(0 if failed == 0 else 1)
