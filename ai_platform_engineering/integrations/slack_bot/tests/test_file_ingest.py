"""Tests for Slack attachment ingestion into ChatRequest.files.

Verifies ``download_slack_files`` authenticates with the bot token, base64-
encodes downloaded bytes into the ``InputFile`` dict shape, and skips files it
cannot or should not ingest (no token, missing url/mime, oversize, HTTP error)
without sinking the rest of the turn. It returns an ``IngestResult(files,
notices)``: ``files`` are the usable attachments, ``notices`` are user-facing
strings for files that were attached but **inaccessible** (missing token, bad
url, download failure, or the ``files:read`` HTML-login-page failure) so the
agent can tell the user rather than silently dropping them — while benign
size-cap skips add no notice.
"""

from __future__ import annotations

import base64

import ai_platform_engineering.integrations.slack_bot.utils.file_ingest as fi

# Valid magic-byte prefixes so downloaded bytes pass the content/type sniff.
# _sniff_ok rejects a declared image/pdf whose leading bytes don't match, so
# tests that assert a successful download must hand back real signatures.
_PNG = b"\x89PNG\r\n\x1a\n" + b"payload"
_JPEG = b"\xff\xd8\xff\xe0" + b"payload"
_PDF = b"%PDF-1.4" + b"payload"


class _FakeResponse:
    def __init__(
        self, content: bytes, status: int = 200, content_type: str | None = None
    ) -> None:
        self.content = content
        self._status = status
        # Mirror requests.Response.headers (case-insensitive in the real lib;
        # a plain dict is enough here since the code reads the exact key).
        self.headers = {"Content-Type": content_type} if content_type else {}

    def raise_for_status(self) -> None:
        if self._status >= 400:
            raise RuntimeError(f"HTTP {self._status}")


def _install_fake_get(
    monkeypatch, *, by_url=None, default=_PNG, status=200, content_type=None
):
    """Patch file_ingest.requests.get, recording the auth headers seen."""
    calls: list[dict] = []

    def fake_get(url, headers=None, timeout=None):
        calls.append({"url": url, "headers": headers or {}, "timeout": timeout})
        content = (by_url or {}).get(url, default)
        return _FakeResponse(content, status=status, content_type=content_type)

    monkeypatch.setattr(fi.requests, "get", fake_get)
    return calls


def test_returns_empty_when_no_files(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    assert fi.download_slack_files(None) == ([], [])
    assert fi.download_slack_files([]) == ([], [])


def test_single_file_is_downloaded_and_base64_encoded(monkeypatch):
    calls = _install_fake_get(monkeypatch, default=_PNG)
    files = [
        {
            "name": "shot.png",
            "mimetype": "image/png",
            "url_private_download": "https://files.slack.com/shot.png",
            "size": len(_PNG),
        }
    ]

    result = fi.download_slack_files(files, bot_token="xoxb-abc")

    assert len(result.files) == 1
    assert result.files[0] == {
        "mime_type": "image/png",
        "data": base64.b64encode(_PNG).decode("ascii"),
        "name": "shot.png",
    }
    assert result.notices == []
    # Auth header carries the bot token — the whole point of ingress.
    assert calls[0]["headers"]["Authorization"] == "Bearer xoxb-abc"


def test_multiple_files_preserve_order(monkeypatch):
    _install_fake_get(
        monkeypatch,
        by_url={
            "https://files.slack.com/a.png": _PNG,
            "https://files.slack.com/b.pdf": _PDF,
        },
    )
    files = [
        {"name": "a.png", "mimetype": "image/png", "url_private_download": "https://files.slack.com/a.png"},
        {"name": "b.pdf", "mimetype": "application/pdf", "url_private": "https://files.slack.com/b.pdf"},
    ]

    out = fi.download_slack_files(files, bot_token="t").files

    assert [o["name"] for o in out] == ["a.png", "b.pdf"]
    assert out[0]["data"] == base64.b64encode(_PNG).decode("ascii")
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

    result = fi.download_slack_files(files, bot_token="t")

    assert result.files == []
    # Both were attached but unreadable, so each produces a notice.
    assert len(result.notices) == 2


def test_no_token_skips_all(monkeypatch):
    monkeypatch.delenv("SLACK_INTEGRATION_BOT_TOKEN", raising=False)
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
    called = _install_fake_get(monkeypatch)
    files = [{"name": "x.png", "mimetype": "image/png", "url_private": "https://files.slack.com/x"}]

    result = fi.download_slack_files(files)  # no explicit token, none in env

    assert result.files == []
    # No token is an inaccessible case, so the user should be told.
    assert len(result.notices) == 1
    # We must NOT fire an unauthenticated request (it would fetch a login page).
    assert called == []


def test_token_falls_back_to_env(monkeypatch):
    monkeypatch.delenv("SLACK_INTEGRATION_BOT_TOKEN", raising=False)
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-env")
    calls = _install_fake_get(monkeypatch)
    files = [{"name": "x.png", "mimetype": "image/png", "url_private": "https://files.slack.com/x"}]

    out = fi.download_slack_files(files).files

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

    result = fi.download_slack_files(files, bot_token="t", max_file_bytes=100)

    assert result.files == []
    # A size skip is benign — the file was reachable, just too big — so no notice.
    assert result.notices == []
    # Declared-size guard should short-circuit before any HTTP call.
    assert calls == []


def test_downloaded_oversize_is_skipped(monkeypatch):
    # Slack didn't declare size, but the bytes exceed the cap once fetched.
    _install_fake_get(monkeypatch, default=b"x" * 200)
    files = [{"name": "big", "mimetype": "text/plain", "url_private": "https://files.slack.com/big"}]

    result = fi.download_slack_files(files, bot_token="t", max_file_bytes=100)

    assert result.files == []
    # Post-download size skip is also benign — no notice.
    assert result.notices == []


def test_total_cap_stops_ingestion(monkeypatch):
    _install_fake_get(monkeypatch, default=b"x" * 60)
    files = [
        {"name": "a", "mimetype": "text/plain", "url_private": "https://files.slack.com/a"},
        {"name": "b", "mimetype": "text/plain", "url_private": "https://files.slack.com/b"},
    ]

    # Each is 60 bytes; per-file cap allows them, but total cap of 100 admits
    # only the first.
    out = fi.download_slack_files(
        files, bot_token="t", max_file_bytes=100, max_total_bytes=100
    ).files

    assert [o["name"] for o in out] == ["a"]


def test_http_error_on_one_file_does_not_sink_others(monkeypatch):
    def fake_get(url, headers=None, timeout=None):
        if url.endswith("bad"):
            return _FakeResponse(b"", status=403)
        return _FakeResponse(_PNG)

    monkeypatch.setattr(fi.requests, "get", fake_get)
    files = [
        {"name": "bad", "mimetype": "image/png", "url_private": "https://files.slack.com/bad"},
        {"name": "good", "mimetype": "image/png", "url_private": "https://files.slack.com/good"},
    ]

    result = fi.download_slack_files(files, bot_token="t")

    assert [o["name"] for o in result.files] == ["good"]
    # The failed download is inaccessible, so it produces a notice.
    assert len(result.notices) == 1


# --- Content/type sanity checks (Slack files:read scope regression) ----------


def test_html_login_page_by_content_type_is_skipped(monkeypatch):
    # Missing files:read scope: Slack returns its login page as HTTP 200 with a
    # text/html Content-Type. raise_for_status passes, so this must be caught by
    # the content-type check rather than forwarded as the declared image/png.
    _install_fake_get(
        monkeypatch, default=b"<!DOCTYPE html><html>login</html>",
        content_type="text/html; charset=utf-8",
    )
    files = [{"name": "x.png", "mimetype": "image/png", "url_private": "https://files.slack.com/x"}]

    result = fi.download_slack_files(files, bot_token="t")

    assert result.files == []
    # This is the files:read failure — the notice should hint at the scope.
    assert len(result.notices) == 1
    assert "files:read" in result.notices[0]
    assert "x.png" in result.notices[0]


def test_html_login_page_without_content_type_is_sniffed(monkeypatch):
    # Same failure but Slack omitted/obscured the Content-Type header — the
    # body still begins with an HTML tag, which a real image never does.
    _install_fake_get(
        monkeypatch, default=b"  <html><body>Sign in</body></html>",
        content_type=None,
    )
    files = [{"name": "x.png", "mimetype": "image/png", "url_private": "https://files.slack.com/x"}]

    result = fi.download_slack_files(files, bot_token="t")

    assert result.files == []
    # Still the files:read failure, just detected by sniffing the body.
    assert len(result.notices) == 1
    assert "files:read" in result.notices[0]


def test_declared_image_with_wrong_magic_bytes_is_skipped(monkeypatch):
    # Declared image/png but the bytes are not a PNG (and not HTML either) —
    # still a content/type mismatch we should not forward to the model.
    _install_fake_get(monkeypatch, default=b"not-an-image-at-all")
    files = [{"name": "x.png", "mimetype": "image/png", "url_private": "https://files.slack.com/x"}]

    result = fi.download_slack_files(files, bot_token="t")

    assert result.files == []
    # A content/type mismatch is inaccessible-to-the-model — notify the user
    # (without the files:read hint, since the cause is a generic mismatch).
    assert len(result.notices) == 1


def test_jpeg_and_webp_magic_bytes_pass(monkeypatch):
    webp = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"payload"
    _install_fake_get(
        monkeypatch,
        by_url={
            "https://files.slack.com/j.jpg": _JPEG,
            "https://files.slack.com/w.webp": webp,
        },
    )
    files = [
        {"name": "j.jpg", "mimetype": "image/jpeg", "url_private": "https://files.slack.com/j.jpg"},
        {"name": "w.webp", "mimetype": "image/webp", "url_private": "https://files.slack.com/w.webp"},
    ]

    result = fi.download_slack_files(files, bot_token="t")

    assert [o["name"] for o in result.files] == ["j.jpg", "w.webp"]
    assert result.notices == []


def test_text_upload_containing_html_is_not_rejected(monkeypatch):
    # A real text/plain (or html) upload whose body is HTML source must pass:
    # the sniff only rejects declared *binary* types, and the content-type
    # branch only fires when the declared type is not itself HTML/text.
    _install_fake_get(
        monkeypatch, default=b"<html>this is the user's actual file</html>",
        content_type="text/html",
    )
    files = [{"name": "page.html", "mimetype": "text/html", "url_private": "https://files.slack.com/p"}]

    result = fi.download_slack_files(files, bot_token="t")

    assert [o["name"] for o in result.files] == ["page.html"]
    assert result.notices == []
