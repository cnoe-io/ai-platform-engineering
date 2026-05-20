# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for Webex bot OBO token-exchange configuration."""

from __future__ import annotations

from ai_platform_engineering.integrations.webex_bot.utils.obo_exchange import (
    OboExchangeConfig,
)


def test_default_audience_targets_caipe_ui_bff(monkeypatch) -> None:
    monkeypatch.delenv("KEYCLOAK_WEBEX_BOT_AUDIENCE", raising=False)
    monkeypatch.delenv("CAIPE_PLATFORM_AUDIENCE", raising=False)

    assert OboExchangeConfig().caipe_platform_audience == "caipe-platform"


def test_caipe_platform_audience_env_overrides_default(monkeypatch) -> None:
    monkeypatch.delenv("KEYCLOAK_WEBEX_BOT_AUDIENCE", raising=False)
    monkeypatch.setenv("CAIPE_PLATFORM_AUDIENCE", "custom-platform")

    assert OboExchangeConfig().caipe_platform_audience == "custom-platform"
