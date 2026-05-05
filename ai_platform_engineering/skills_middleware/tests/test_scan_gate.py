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
    # Also clear the admin-override env so each test starts from the
    # documented default (override-on). Tests that need it off set it
    # explicitly via monkeypatch.
    monkeypatch.delenv("ADMIN_SCAN_OVERRIDE_ENABLED", raising=False)


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


# -- Admin override (scan_status == "admin_overridden") -------------------------
#
# `admin_overridden` represents a flagged skill an admin has explicitly
# green-lit via the UI. The gate must allow it under non-strict modes
# when ADMIN_SCAN_OVERRIDE_ENABLED is on (default), block it when the
# operator turns the feature off, and *always* block it under strict
# (strict means "scanner-clean only", overrides ignored). These tests
# pin every cell of that policy table so a future refactor can't
# silently weaken the override invariant in either direction.


class TestIsAdminOverrideEnabled:
    def test_default_is_enabled(self):
        # Override is on by default — matches the UI default. Operators
        # who want regulated behaviour flip the env to "false".
        assert scan_gate.is_admin_override_enabled() is True

    @pytest.mark.parametrize("value", ["false", "FALSE", "0", "no", "off"])
    def test_falsy_values_disable(self, monkeypatch, value):
        monkeypatch.setenv("ADMIN_SCAN_OVERRIDE_ENABLED", value)
        assert scan_gate.is_admin_override_enabled() is False

    @pytest.mark.parametrize("value", ["true", "TRUE", "1", "yes", "on", ""])
    def test_truthy_or_unknown_values_enable(self, monkeypatch, value):
        # Permissive parsing: any non-explicit-false string keeps the
        # feature on, so an accidental typo doesn't silently disable
        # the admin escape hatch.
        monkeypatch.setenv("ADMIN_SCAN_OVERRIDE_ENABLED", value)
        assert scan_gate.is_admin_override_enabled() is True


class TestIsStatusBlockedForAdminOverride:
    def test_overridden_allowed_under_warn_when_feature_on(self, monkeypatch):
        # The whole point: an admin-overridden skill loads in the
        # default (warn) gate when the override feature is enabled.
        monkeypatch.setenv("SKILL_SCANNER_GATE", "warn")
        # ADMIN_SCAN_OVERRIDE_ENABLED unset ⇒ default-on.
        assert scan_gate.is_status_blocked("admin_overridden") is False

    def test_overridden_allowed_under_off_when_feature_on(self, monkeypatch):
        monkeypatch.setenv("SKILL_SCANNER_GATE", "off")
        assert scan_gate.is_status_blocked("admin_overridden") is False

    def test_overridden_blocked_under_strict_even_when_feature_on(
        self, monkeypatch
    ):
        # Strict means "I trust only the scanner." Overrides are
        # intentionally ignored — the regulated-environment escape
        # hatch must remain. Flipping ADMIN_SCAN_OVERRIDE_ENABLED on
        # cannot weaken strict.
        monkeypatch.setenv("SKILL_SCANNER_GATE", "strict")
        monkeypatch.setenv("ADMIN_SCAN_OVERRIDE_ENABLED", "true")
        assert scan_gate.is_status_blocked("admin_overridden") is True

    def test_overridden_blocked_when_feature_off(self, monkeypatch):
        # Operator turned the feature off ⇒ override falls back to
        # being treated as flagged (blocked) regardless of gate.
        monkeypatch.setenv("ADMIN_SCAN_OVERRIDE_ENABLED", "false")
        for gate in ("strict", "warn", "off"):
            monkeypatch.setenv("SKILL_SCANNER_GATE", gate)
            assert scan_gate.is_status_blocked("admin_overridden") is True, (
                f"override-off under gate={gate} should block "
                "admin_overridden"
            )

    def test_flagged_invariant_unaffected_by_override_flag(self, monkeypatch):
        # The flagged-is-always-blocked invariant has nothing to do
        # with admin_overridden. Toggling the override flag must not
        # accidentally rescue plain flagged skills.
        for override_state in ("true", "false"):
            monkeypatch.setenv(
                "ADMIN_SCAN_OVERRIDE_ENABLED", override_state
            )
            for gate in ("strict", "warn", "off"):
                monkeypatch.setenv("SKILL_SCANNER_GATE", gate)
                assert scan_gate.is_status_blocked("flagged") is True


class TestMongoScanFilterForAdminOverride:
    def test_warn_with_override_on_keeps_legacy_predicate(self, monkeypatch):
        # When the override feature is on (default), the predicate
        # excludes only "flagged" — `admin_overridden` is allowed
        # alongside everything else. This is the same predicate the
        # supervisor and dynamic-agents loaders have always used in
        # warn mode, so existing callers see no behaviour change.
        monkeypatch.setenv("SKILL_SCANNER_GATE", "warn")
        assert scan_gate.mongo_scan_filter() == {
            "scan_status": {"$ne": "flagged"}
        }

    def test_warn_with_override_off_excludes_overridden_too(
        self, monkeypatch
    ):
        # Operator disabled the override feature ⇒ the predicate must
        # also exclude `admin_overridden`. Without this, callers that
        # use the predicate alone (without the per-doc Python check)
        # would happily serve overridden skills even though the
        # feature is off — defeating the env flag.
        monkeypatch.setenv("SKILL_SCANNER_GATE", "warn")
        monkeypatch.setenv("ADMIN_SCAN_OVERRIDE_ENABLED", "false")
        assert scan_gate.mongo_scan_filter() == {
            "scan_status": {"$nin": ["flagged", "admin_overridden"]}
        }

    def test_strict_unaffected_by_override_flag(self, monkeypatch):
        # Strict = passed-only, regardless of the override feature.
        monkeypatch.setenv("SKILL_SCANNER_GATE", "strict")
        for override_state in ("true", "false"):
            monkeypatch.setenv(
                "ADMIN_SCAN_OVERRIDE_ENABLED", override_state
            )
            assert scan_gate.mongo_scan_filter() == {
                "scan_status": {"$in": ["passed"]}
            }


class TestIsSkillBlockedForAdminOverride:
    def test_reads_admin_overridden_from_dict(self, monkeypatch):
        monkeypatch.setenv("SKILL_SCANNER_GATE", "warn")
        assert scan_gate.is_skill_blocked(
            {"scan_status": "admin_overridden"}
        ) is False

    def test_strict_blocks_admin_overridden_dict(self, monkeypatch):
        monkeypatch.setenv("SKILL_SCANNER_GATE", "strict")
        assert scan_gate.is_skill_blocked(
            {"scan_status": "admin_overridden"}
        ) is True
