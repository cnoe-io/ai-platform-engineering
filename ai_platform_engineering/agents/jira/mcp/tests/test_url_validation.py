# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6

"""Tests for Jira MCP URL hostname validation (example.com placeholder detection)."""

from unittest.mock import AsyncMock, MagicMock, patch


class TestJiraClientURLValidation:
    """Tests for validate_prerequisites URL check in mcp_jira/api/client.py."""

    def _call_validate(self, url: str):
        with patch.dict("os.environ", {
            "ATLASSIAN_TOKEN": "real-token",
            "ATLASSIAN_EMAIL": "user@real.com",
            "ATLASSIAN_API_URL": url,
        }):
            from mcp_jira.api.client import validate_prerequisites
            return validate_prerequisites()

    def test_real_atlassian_url_accepted(self):
        ok, _ = self._call_validate("https://mycompany.atlassian.net")
        assert ok is True

    def test_example_com_rejected(self):
        ok, result = self._call_validate("https://example.com")
        assert ok is False
        assert "Invalid" in result.get("error", "")

    def test_jira_example_com_rejected(self):
        ok, result = self._call_validate("https://jira.example.com")
        assert ok is False
        assert "Invalid" in result.get("error", "")

    def test_subdomain_of_example_com_rejected(self):
        ok, result = self._call_validate("https://mycompany.example.com")
        assert ok is False

    def test_no_false_positive_example_in_path(self):
        # example.com appears only in the path, not the hostname
        ok, _ = self._call_validate("https://mycompany.atlassian.net/example.com/page")
        assert ok is True


class TestJiraSearchURLValidation:
    """Tests for example.com check in mcp_jira/tools/jira/search.py."""

    def _env_with_url(self, url: str):
        return {
            "ATLASSIAN_TOKEN": "real-token",
            "ATLASSIAN_EMAIL": "user@real.com",
            "ATLASSIAN_API_URL": url,
        }

    def test_example_com_returns_error_string(self):
        with patch.dict("os.environ", self._env_with_url("https://example.com")):
            from mcp_jira.tools.jira.search import search_jira_issues

            result = search_jira_issues(jql="project = TEST")
            assert "Error" in str(result) or "Invalid" in str(result)

    def test_real_url_passes_validation_stage(self):
        with patch.dict("os.environ", self._env_with_url("https://mycompany.atlassian.net")):
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"issues": [], "total": 0}
            mock_http = MagicMock()
            mock_http.post = AsyncMock(return_value=mock_response)
            mock_ctx = MagicMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_http)
            mock_ctx.__aexit__ = AsyncMock(return_value=None)
            with patch("mcp_jira.tools.jira.search.httpx.AsyncClient", return_value=mock_ctx):
                from mcp_jira.tools.jira.search import search_jira_issues

                result = search_jira_issues(jql="project = TEST")
                assert "Error" not in str(result)
