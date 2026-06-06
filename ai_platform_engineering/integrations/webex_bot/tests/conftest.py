# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Shared fixtures for Webex bot tests."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _configured_webex_workspace(monkeypatch: pytest.MonkeyPatch) -> None:
    """Policy namespace comes from deployment env, not webhook payloads."""
    monkeypatch.setenv("WEBEX_WORKSPACE_ALIAS", "CAIPE-WEBEX")
    monkeypatch.delenv("WEBEX_WORKSPACE_ID", raising=False)
