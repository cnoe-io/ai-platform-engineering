# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for the vendored ``dynamic_agents.services.scan_gate`` module.

The vendored copy exists because the dynamic-agents Docker image
ships only the ``dynamic_agents`` package — not its supervisor-side
``ai_platform_engineering.skills_middleware.scan_gate`` source-of-
truth. The cross-package import that lived inline in
``services/skills.py::_load_agent_skills`` raised ``ModuleNotFoundError``
at runtime, was caught by a broad ``except`` and silently returned
``[]``, and made every dynamic agent's virtual filesystem appear
empty to the LLM ("the filesystem appears to be empty or
inaccessible").

Two responsibilities for this test file:

  1. Pin the policy table on the vendored side so a copy-paste edit
     can't silently weaken the security invariant
     ("flagged is always blocked"). These mirror the suite in
     ``skills_middleware/tests/test_scan_gate.py``.

  2. Detect drift. The vendored module is supposed to be a verbatim
     copy of the source-of-truth one (sans the docstring). A test
     compares the function bodies and the ``__all__`` surface of the
     two modules, so a single-sided edit fails CI loudly. If a future
     refactor ships ``skills_middleware`` as a real installable
     subpackage, that test will fail-and-tell-you-which-direction.
"""

from __future__ import annotations

import inspect

import pytest

from dynamic_agents.services import scan_gate


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    monkeypatch.delenv("SKILL_SCANNER_GATE", raising=False)


# -- Policy table (mirrors skills_middleware/tests/test_scan_gate.py) -------


class TestGetScanGate:
    def test_default_is_warn(self):
        assert scan_gate.get_scan_gate() == "warn"

    def test_unknown_value_falls_back(self, monkeypatch):
        monkeypatch.setenv("SKILL_SCANNER_GATE", "yolo")
        assert scan_gate.get_scan_gate() == "warn"

    @pytest.mark.parametrize("value", ["strict", "warn", "off"])
    def test_known_values(self, monkeypatch, value):
        monkeypatch.setenv("SKILL_SCANNER_GATE", value)
        assert scan_gate.get_scan_gate() == value


class TestIsStatusBlocked:
    def test_flagged_always_blocked(self, monkeypatch):
        # The hard security invariant: flagged is unconditional.
        # If a future refactor lets a non-strict gate serve flagged
        # content, the dynamic-agents container would too.
        for gate in ("strict", "warn", "off"):
            monkeypatch.setenv("SKILL_SCANNER_GATE", gate)
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


# -- Drift detection: vendored copy ↔ source-of-truth -----------------------


class TestVendorDriftAgainstSourceOfTruth:
    """Fail loudly when the vendored module diverges from the source.

    The dev monorepo ships both modules side-by-side, so this test
    runs in CI without needing the dynamic-agents container. If
    pytest is run inside the container (where ``ai_platform_engineering``
    isn't installed), the test self-skips — there's nothing to compare
    against, but the policy-table tests above still pin behaviour.
    """

    @pytest.fixture
    def source_of_truth(self):
        try:
            from ai_platform_engineering.skills_middleware import (  # type: ignore[import-not-found]
                scan_gate as upstream,
            )
        except ModuleNotFoundError:
            pytest.skip(
                "skills_middleware not on PYTHONPATH (likely running "
                "inside the dynamic-agents container) — drift check "
                "is dev-monorepo / CI-only"
            )
        return upstream

    def test_public_api_matches(self, source_of_truth):
        # __all__ must be identical so callers can't depend on a
        # symbol that exists in only one copy.
        assert sorted(scan_gate.__all__) == sorted(source_of_truth.__all__)

    def test_function_bodies_identical(self, source_of_truth):
        # Compare the executable source of every public function.
        # We strip the docstring / leading whitespace so a comment
        # tweak doesn't fail the test, but any logic edit does.
        for name in scan_gate.__all__:
            ours = inspect.getsource(getattr(scan_gate, name))
            theirs = inspect.getsource(getattr(source_of_truth, name))
            assert ours == theirs, (
                f"{name}() drifted between dynamic_agents/services/"
                f"scan_gate.py and skills_middleware/scan_gate.py — "
                "the policy must stay byte-identical between the two "
                "copies. Re-vendor by copying the source-of-truth "
                "function bodies into the vendored module."
            )

    def test_default_gate_constant_matches(self, source_of_truth):
        # The leading underscore makes _DEFAULT_GATE technically
        # private, but the policy depends on it being equal across
        # both files: a one-sided change to "strict" is exactly the
        # bug we shipped before.
        assert scan_gate._DEFAULT_GATE == source_of_truth._DEFAULT_GATE
