"""Smoke-check Slack route miss handling does not silently return."""

from __future__ import annotations

import pathlib


_APP_PY = pathlib.Path(__file__).resolve().parents[1] / "app.py"


def test_channel_route_miss_posts_ephemeral_notice() -> None:
    src = _APP_PY.read_text(encoding="utf-8")

    assert "explain_no_route_match" in src
    assert "chat_postEphemeral" in src
    assert "Slack route miss notice" in src
