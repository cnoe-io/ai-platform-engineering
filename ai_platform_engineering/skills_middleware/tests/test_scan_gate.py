# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
# assisted-by cursor (composer-2-fast)
"""Unit tests for the shared skill scan-gating policy.

Pins the rule "flagged is always blocked, unscanned blocked under
strict gate" so a future refactor can't silently weaken it. The
runtime invariant the gate protects is that no skill the security
scanner has marked unsafe can be served to the supervisor catalog
or to dynamic agents.
"""

from __future__ import annotations

import pytest

from ai_platform_engineering.skills_middleware import scan_gate


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    monkeypatch.delenv("SKILL_SCANNER_GATE", raising=False)


class TestGetScanGate:
    def test_default_is_strict(self):
        # Strict-by-default is part of the security policy: a fresh
        # deploy with no scanner config still excludes unscanned
        # content from the runtime.
        assert scan_gate.get_scan_gate() == "strict"

    def test_unknown_value_falls_back(self, monkeypatch):
        monkeypatch.setenv("SKILL_SCANNER_GATE", "yolo")
        assert scan_gate.get_scan_gate() == "strict"

    @pytest.mark.parametrize("value", ["strict", "warn", "off"])
    def test_known_values(self, monkeypatch, value):
        monkeypatch.setenv("SKILL_SCANNER_GATE", value)
        assert scan_gate.get_scan_gate() == value


class TestIsStatusBlocked:
    def test_flagged_always_blocked_under_strict(self, monkeypatch):
        monkeypatch.setenv("SKILL_SCANNER_GATE", "strict")
        assert scan_gate.is_status_blocked("flagged") is True

    def test_flagged_always_blocked_under_warn(self, monkeypatch):
        # The hard invariant: flagged is unconditional. A deployment
        # that flips the gate to "warn" must NOT start serving
        # flagged content.
        monkeypatch.setenv("SKILL_SCANNER_GATE", "warn")
        assert scan_gate.is_status_blocked("flagged") is True

    def test_flagged_always_blocked_under_off(self, monkeypatch):
        monkeypatch.setenv("SKILL_SCANNER_GATE", "off")
        assert scan_gate.is_status_blocked("flagged") is True

    def test_passed_always_allowed(self, monkeypatch):
        for gate in ("strict", "warn", "off"):
            monkeypatch.setenv("SKILL_SCANNER_GATE", gate)
            assert scan_gate.is_status_blocked("passed") is False

    def test_unscanned_blocked_only_under_strict(self, monkeypatch):
        monkeypatch.setenv("SKILL_SCANNER_GATE", "strict")
        assert scan_gate.is_status_blocked("unscanned") is True
        assert scan_gate.is_status_blocked(None) is True
        assert scan_gate.is_status_blocked("") is True
        monkeypatch.setenv("SKILL_SCANNER_GATE", "warn")
        assert scan_gate.is_status_blocked("unscanned") is False
        assert scan_gate.is_status_blocked(None) is False


class TestIsSkillBlocked:
    def test_reads_scan_status_from_dict(self, monkeypatch):
        monkeypatch.setenv("SKILL_SCANNER_GATE", "strict")
        assert scan_gate.is_skill_blocked({"scan_status": "flagged"}) is True
        assert scan_gate.is_skill_blocked({"scan_status": "passed"}) is False
        # Missing field under strict ⇒ blocked.
        assert scan_gate.is_skill_blocked({}) is True


class TestMongoScanFilter:
    def test_strict_allows_only_passed(self, monkeypatch):
        monkeypatch.setenv("SKILL_SCANNER_GATE", "strict")
        assert scan_gate.mongo_scan_filter() == {
            "scan_status": {"$in": ["passed"]}
        }

    def test_non_strict_blocks_only_flagged(self, monkeypatch):
        monkeypatch.setenv("SKILL_SCANNER_GATE", "warn")
        assert scan_gate.mongo_scan_filter() == {
            "scan_status": {"$ne": "flagged"}
        }
