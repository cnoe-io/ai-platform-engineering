"""Tests for Slack attachment ingestion into ChatRequest.files.

Verifies ``download_slack_files`` authenticates with the bot token, base64-
encodes downloaded bytes into the ``InputFile`` dict shape, and skips files it
cannot or should not ingest (no token, missing url/mime, oversize, HTTP error)
without sinking the rest of the turn.
"""

from __future__ import annotations

import base64

import ai_platform_engineering.integrations.slack_bot.utils.file_ingest as fi


class _FakeResponse:
    def __init__(self, content: bytes, status: int = 200) -> None:
        self.content = content
        self._status = status

    def raise_for_status(self) -> None:
        if self._status >= 400:
            raise RuntimeError(f"HTTP {self._status}")


def _install_fake_get(monkeypatch, *, by_url=None, default=b"bytes", status=200):
    """Patch file_ingest.requests.get, recording the auth headers seen."""
    calls: list[dict] = []

    def fake_get(url, headers=None, timeout=None):
        calls.append({"url": url, "headers": headers or {}, "timeout": timeout})
        content = (by_url or {}).get(url, default)
        return _FakeResponse(content, status=status)

    monkeypatch.setattr(fi.requests, "get", fake_get)
    return calls


def test_returns_empty_when_no_files(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    assert fi.download_slack_files(None) == []
    assert fi.download_slack_files([]) == []


def test_single_file_is_downloaded_and_base64_encoded(monkeypatch):
    calls = _install_fake_get(monkeypatch, default=b"hello-bytes")
    files = [
        {
            "name": "shot.png",
            "mimetype": "image/png",
            "url_private_download": "https://files.slack.com/shot.png",
            "size": 11,
        }
    ]

    out = fi.download_slack_files(files, bot_token="xoxb-abc")

    assert len(out) == 1
    assert out[0] == {
        "mime_type": "image/png",
        "data": base64.b64encode(b"hello-bytes").decode("ascii"),
        "name": "shot.png",
    }
    # Auth header carries the bot token — the whole point of ingress.
    assert calls[0]["headers"]["Authorization"] == "Bearer xoxb-abc"


def test_multiple_files_preserve_order(monkeypatch):
    _install_fake_get(
        monkeypatch,
        by_url={
            "https://files.slack.com/a.png": b"aaa",
            "https://files.slack.com/b.pdf": b"bbbb",
        },
    )
    files = [
        {"name": "a.png", "mimetype": "image/png", "url_private_download": "https://files.slack.com/a.png"},
        {"name": "b.pdf", "mimetype": "application/pdf", "url_private": "https://files.slack.com/b.pdf"},
    ]

    out = fi.download_slack_files(files, bot_token="t")

    assert [o["name"] for o in out] == ["a.png", "b.pdf"]
    assert out[0]["data"] == base64.b64encode(b"aaa").decode("ascii")
    assert out[1]["mime_type"] == "application/pdf"


def test_url_private_download_preferred_over_url_private(monkeypatch):
    calls = _install_fake_get(monkeypatch)
    files = [
        {
            "name": "x.png",
            "mimetype": "image/png",
            "url_private_download": "https://files.slack.com/download",
            "url_private": "https://files.slack.com/inline",
        }
    ]

    fi.download_slack_files(files, bot_token="t")

    assert calls[0]["url"] == "https://files.slack.com/download"


def test_missing_url_or_mimetype_is_skipped(monkeypatch):
    _install_fake_get(monkeypatch)
    files = [
        {"name": "no-url.png", "mimetype": "image/png"},           # no url
        {"name": "no-mime", "url_private": "https://files.slack.com/x"},  # no mimetype
    ]

    assert fi.download_slack_files(files, bot_token="t") == []


def test_no_token_skips_all(monkeypatch):
    monkeypatch.delenv("SLACK_INTEGRATION_BOT_TOKEN", raising=False)
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
    called = _install_fake_get(monkeypatch)
    files = [{"name": "x.png", "mimetype": "image/png", "url_private": "https://files.slack.com/x"}]

    out = fi.download_slack_files(files)  # no explicit token, none in env

    assert out == []
    # We must NOT fire an unauthenticated request (it would fetch a login page).
    assert called == []


def test_token_falls_back_to_env(monkeypatch):
    monkeypatch.delenv("SLACK_INTEGRATION_BOT_TOKEN", raising=False)
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-env")
    calls = _install_fake_get(monkeypatch)
    files = [{"name": "x.png", "mimetype": "image/png", "url_private": "https://files.slack.com/x"}]

    out = fi.download_slack_files(files)

    assert len(out) == 1
    assert calls[0]["headers"]["Authorization"] == "Bearer xoxb-env"


def test_declared_oversize_is_skipped_without_download(monkeypatch):
    calls = _install_fake_get(monkeypatch)
    files = [
        {
            "name": "big.pdf",
            "mimetype": "application/pdf",
            "url_private": "https://files.slack.com/big",
            "size": 999,
        }
    ]

    out = fi.download_slack_files(files, bot_token="t", max_file_bytes=100)

    assert out == []
    # Declared-size guard should short-circuit before any HTTP call.
    assert calls == []


def test_downloaded_oversize_is_skipped(monkeypatch):
    # Slack didn't declare size, but the bytes exceed the cap once fetched.
    _install_fake_get(monkeypatch, default=b"x" * 200)
    files = [{"name": "big", "mimetype": "text/plain", "url_private": "https://files.slack.com/big"}]

    out = fi.download_slack_files(files, bot_token="t", max_file_bytes=100)

    assert out == []


def test_total_cap_stops_ingestion(monkeypatch):
    _install_fake_get(monkeypatch, default=b"x" * 60)
    files = [
        {"name": "a", "mimetype": "text/plain", "url_private": "https://files.slack.com/a"},
        {"name": "b", "mimetype": "text/plain", "url_private": "https://files.slack.com/b"},
    ]

    # Each is 60 bytes; per-file cap allows them, but total cap of 100 admits
    # only the first.
    out = fi.download_slack_files(files, bot_token="t", max_file_bytes=100, max_total_bytes=100)

    assert [o["name"] for o in out] == ["a"]


def test_http_error_on_one_file_does_not_sink_others(monkeypatch):
    def fake_get(url, headers=None, timeout=None):
        if url.endswith("bad"):
            return _FakeResponse(b"", status=403)
        return _FakeResponse(b"ok")

    monkeypatch.setattr(fi.requests, "get", fake_get)
    files = [
        {"name": "bad", "mimetype": "image/png", "url_private": "https://files.slack.com/bad"},
        {"name": "good", "mimetype": "image/png", "url_private": "https://files.slack.com/good"},
    ]

    out = fi.download_slack_files(files, bot_token="t")

    assert [o["name"] for o in out] == ["good"]
