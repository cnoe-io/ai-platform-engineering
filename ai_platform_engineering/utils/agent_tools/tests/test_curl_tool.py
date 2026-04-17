# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for curl_tool — guardrails, subprocess behaviour, strip_html."""

import subprocess
from unittest.mock import MagicMock, patch

from ai_platform_engineering.utils.agent_tools.curl_tool import (
    _validate_curl_args,
    curl,
)


# ---------------------------------------------------------------------------
# _validate_curl_args — URL guardrail
# ---------------------------------------------------------------------------

class TestValidateCurlArgs:

    def test_https_url_accepted(self):
        assert _validate_curl_args(["-s", "https://api.example.com/users"]) is None

    def test_https_url_with_path_and_query_accepted(self):
        assert _validate_curl_args(["https://api.example.com/v1/items?limit=10"]) is None

    def test_http_url_rejected(self):
        msg = _validate_curl_args(["http://api.example.com"])
        assert msg is not None
        assert "http://" in msg
        assert "https://" in msg

    def test_file_url_rejected(self):
        msg = _validate_curl_args(["file:///etc/passwd"])
        assert msg is not None
        assert "file://" in msg

    def test_ftp_url_rejected(self):
        msg = _validate_curl_args(["ftp://files.example.com/data"])
        assert msg is not None
        assert "ftp://" in msg

    def test_no_url_in_args_accepted(self):
        assert _validate_curl_args(["-s", "-X", "GET", "-H", "Accept: application/json"]) is None

    def test_empty_args_accepted(self):
        assert _validate_curl_args([]) is None

    def test_error_message_strips_query_string(self):
        msg = _validate_curl_args(["http://api.example.com/path?token=secret"])
        assert "token=secret" not in msg
        assert "http://api.example.com/path" in msg

    def test_error_message_mentions_supported_protocols(self):
        msg = _validate_curl_args(["ftp://files.example.com"])
        assert "http://" in msg
        assert "file://" in msg
        assert "ftp://" in msg

    def test_multiple_args_one_bad_url_rejected(self):
        msg = _validate_curl_args(["-s", "-X", "PUT", "http://internal/api"])
        assert msg is not None
        assert "http://" in msg


# ---------------------------------------------------------------------------
# curl tool — argument handling
# ---------------------------------------------------------------------------

class TestCurlArgHandling:

    def _make_completed_process(self, stdout="ok", returncode=0, stderr=""):
        result = MagicMock(spec=subprocess.CompletedProcess)
        result.stdout = stdout
        result.stderr = stderr
        result.returncode = returncode
        return result

    def test_curl_prefix_prepended_when_missing(self):
        with patch("subprocess.run", return_value=self._make_completed_process()) as mock_run:
            curl.invoke({"command": "-s https://api.example.com"})
        args = mock_run.call_args[0][0]
        assert args[0] == "curl"

    def test_curl_prefix_not_doubled(self):
        with patch("subprocess.run", return_value=self._make_completed_process()) as mock_run:
            curl.invoke({"command": "curl -s https://api.example.com"})
        args = mock_run.call_args[0][0]
        assert args.count("curl") == 1

    def test_put_request_args_passed_through(self):
        with patch("subprocess.run", return_value=self._make_completed_process(stdout='{"status":"ok"}')) as mock_run:
            result = curl.invoke({"command": "curl -s -X PUT https://api.example.com/resource -d '{\"key\":\"val\"}'"})
        args = mock_run.call_args[0][0]
        assert "-X" in args
        assert "PUT" in args
        assert result == '{"status":"ok"}'

    def test_invalid_shlex_returns_error(self):
        result = curl.invoke({"command": "curl 'unterminated"})
        assert result.startswith("ERROR:")
        assert "parse" in result.lower()

    def test_http_url_blocked_before_subprocess(self):
        with patch("subprocess.run") as mock_run:
            result = curl.invoke({"command": "curl -s http://api.example.com"})
        mock_run.assert_not_called()
        assert "http://" in result
        assert "https://" in result

    def test_file_url_blocked_before_subprocess(self):
        with patch("subprocess.run") as mock_run:
            result = curl.invoke({"command": "curl file:///etc/passwd"})
        mock_run.assert_not_called()
        assert "file://" in result


# ---------------------------------------------------------------------------
# curl tool — subprocess result handling
# ---------------------------------------------------------------------------

class TestCurlSubprocessResults:

    def _make_completed_process(self, stdout="", returncode=0, stderr=""):
        result = MagicMock(spec=subprocess.CompletedProcess)
        result.stdout = stdout
        result.stderr = stderr
        result.returncode = returncode
        return result

    def test_successful_response_returned(self):
        with patch("subprocess.run", return_value=self._make_completed_process(stdout="hello")):
            result = curl.invoke({"command": "curl -s https://api.example.com"})
        assert result == "hello"

    def test_empty_output_returns_success_message(self):
        with patch("subprocess.run", return_value=self._make_completed_process(stdout="")):
            result = curl.invoke({"command": "curl -s https://api.example.com"})
        assert result == "Success (no output)"

    def test_nonzero_exit_code_returns_error(self):
        with patch("subprocess.run", return_value=self._make_completed_process(stdout="", stderr="connection refused", returncode=7)):
            result = curl.invoke({"command": "curl -s https://api.example.com"})
        assert result.startswith("ERROR:")

    def test_stderr_appended_to_stdout(self):
        with patch("subprocess.run", return_value=self._make_completed_process(stdout="data", stderr="warning", returncode=0)):
            result = curl.invoke({"command": "curl -s https://api.example.com"})
        assert "data" in result
        assert "warning" in result

    def test_timeout_returns_error(self):
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="curl", timeout=1)):
            result = curl.invoke({"command": "curl -s https://api.example.com", "timeout": 1})
        assert "timed out" in result.lower()

    def test_curl_not_found_returns_error(self):
        with patch("subprocess.run", side_effect=FileNotFoundError):
            result = curl.invoke({"command": "curl -s https://api.example.com"})
        assert "curl command not found" in result


# ---------------------------------------------------------------------------
# curl tool — strip_html
# ---------------------------------------------------------------------------

class TestCurlStripHtml:

    def _make_completed_process(self, stdout=""):
        result = MagicMock(spec=subprocess.CompletedProcess)
        result.stdout = stdout
        result.stderr = ""
        result.returncode = 0
        return result

    def test_strip_html_removes_tags(self):
        html = "<html><body><h1>Title</h1><p>Content</p><script>js()</script></body></html>"
        with patch("subprocess.run", return_value=self._make_completed_process(stdout=html)):
            result = curl.invoke({"command": "curl -s https://example.com", "strip_html": True})
        assert "<html>" not in result
        assert "Title" in result
        assert "Content" in result
        assert "js()" not in result

    def test_strip_html_false_returns_raw(self):
        html = "<html><body><p>Hello</p></body></html>"
        with patch("subprocess.run", return_value=self._make_completed_process(stdout=html)):
            result = curl.invoke({"command": "curl -s https://example.com", "strip_html": False})
        assert "<html>" in result

    def test_strip_html_default_is_false(self):
        html = "<p>raw</p>"
        with patch("subprocess.run", return_value=self._make_completed_process(stdout=html)):
            result = curl.invoke({"command": "curl -s https://example.com"})
        assert "<p>" in result
