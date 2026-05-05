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
    def test_default_is_warn(self):
        # Warn-by-default keeps the feature working in deployments
        # without the optional skill-scanner sidecar (the common
        # case): unscanned skills still load, but ``flagged`` is
        # always rejected. Strict is opt-in via env.
        assert scan_gate.get_scan_gate() == "warn"

    def test_unknown_value_falls_back(self, monkeypatch):
        monkeypatch.setenv("SKILL_SCANNER_GATE", "yolo")
        assert scan_gate.get_scan_gate() == "warn"

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


class TestDefaultGateAllowsUnscannedSkills:
    """Regression test for the dynamic-agents 'skill failed to load'
    bug: with ``SKILL_SCANNER_GATE`` unset and no scanner deployed,
    every skill in agent_skills/hub_skills has ``scan_status`` either
    missing or ``"unscanned"``. The default gate must let those rows
    through; otherwise the picker shows skills that the runtime then
    refuses to load.
    """

    def test_unscanned_passes_default_filter(self):
        # Default gate is warn → only ``flagged`` is filtered out.
        # Mongo evaluates ``$ne: "flagged"`` as true for both missing
        # and ``"unscanned"`` values, so both kinds of legacy rows
        # match the filter and load successfully.
        f = scan_gate.mongo_scan_filter()
        assert f == {"scan_status": {"$ne": "flagged"}}

    def test_python_check_allows_unscanned_under_default(self):
        for status in (None, "", "unscanned", "passed"):
            assert scan_gate.is_status_blocked(status) is False, (
                f"default gate should allow status={status!r}"
            )

    def test_python_check_still_blocks_flagged_under_default(self):
        # The flagged invariant must survive the default change:
        # warn-by-default does NOT mean we serve flagged content.
        assert scan_gate.is_status_blocked("flagged") is True
        assert scan_gate.is_skill_blocked({"scan_status": "flagged"}) is True
