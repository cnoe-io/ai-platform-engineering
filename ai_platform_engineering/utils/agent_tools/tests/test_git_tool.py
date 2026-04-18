# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6

"""Unit tests for _detect_git_provider — URL hostname-based detection."""

import pytest
from unittest.mock import patch
from ai_platform_engineering.utils.agent_tools.git_tool import _detect_git_provider


class TestDetectGitProvider:

    def test_github_dot_com(self):
        assert _detect_git_provider("https://github.com/owner/repo") == "github"

    def test_github_subdomain(self):
        assert _detect_git_provider("https://api.github.com/repos/owner/repo") == "github"

    def test_gitlab_dot_com(self):
        assert _detect_git_provider("https://gitlab.com/owner/repo") == "gitlab"

    def test_gitlab_subdomain(self):
        assert _detect_git_provider("https://api.gitlab.com/projects/1") == "gitlab"

    def test_github_ssh(self):
        assert _detect_git_provider("git@github.com:owner/repo.git") == "github"

    def test_gitlab_ssh(self):
        assert _detect_git_provider("git@gitlab.com:owner/repo.git") == "gitlab"

    def test_unknown_domain(self):
        assert _detect_git_provider("https://example.com/repo") == "unknown"

    def test_no_false_positive_github_in_path(self):
        # "github" should not match if it only appears in the path, not the hostname
        result = _detect_git_provider("https://example.com/github/repo")
        assert result == "unknown"

    def test_no_false_positive_gitlab_in_path(self):
        result = _detect_git_provider("https://example.com/gitlab/repo")
        assert result == "unknown"

    def test_custom_github_host_env(self):
        with patch.dict("os.environ", {"GITHUB_HOST": "mygithub.corp.com"}):
            assert _detect_git_provider("https://mygithub.corp.com/owner/repo") == "github"

    def test_custom_gitlab_host_env(self):
        with patch.dict("os.environ", {"GITLAB_HOST": "mygitlab.corp.com"}):
            assert _detect_git_provider("https://mygitlab.corp.com/owner/repo") == "gitlab"

    def test_github_bare_string(self):
        assert _detect_git_provider("github") == "github"

    def test_gitlab_bare_string(self):
        assert _detect_git_provider("gitlab") == "gitlab"
