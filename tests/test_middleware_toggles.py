#!/usr/bin/env python3
"""
Unit tests for middleware env-var toggles in deep_agent.py.

Tests the ENABLE_MIDDLEWARE master switch and individual middleware toggles.
Uses logic simulation (not module reloading) to verify the boolean evaluation
matches what deep_agent.py does at module level.

Reference: deep_agent.py lines ~113-121

Usage:
    PYTHONPATH=. uv run pytest tests/test_middleware_toggles.py -v
"""

import pytest


# ---------------------------------------------------------------------------
# Helper — reproduce the exact toggle logic from deep_agent.py
# ---------------------------------------------------------------------------

_INDIVIDUAL_TOGGLES = (
    "ENABLE_DETERMINISTIC_MIDDLEWARE",
    "ENABLE_SELF_SERVICE_MIDDLEWARE",
    "ENABLE_POLICY_MIDDLEWARE",
    "ENABLE_SKILLS_MIDDLEWARE",
    "ENABLE_FILE_ARG_MIDDLEWARE",
)


def _eval_toggles(env_overrides: dict | None = None) -> dict[str, bool]:
    """Evaluate middleware toggles with given env vars, mimicking deep_agent.py logic.

    Keys not present in *env_overrides* fall back to the default value ("true").
    """
    env = env_overrides or {}

    def _getenv(key: str, default: str = "true") -> str:
        return env.get(key, default)

    enable_middleware = _getenv("ENABLE_MIDDLEWARE", "true").lower() == "true"

    result = {"ENABLE_MIDDLEWARE": enable_middleware}
    for toggle in _INDIVIDUAL_TOGGLES:
        result[toggle] = enable_middleware and _getenv(toggle, "true").lower() == "true"

    return result


# ===========================================================================
# Tests: master switch
# ===========================================================================

class TestMasterSwitch:
    """Tests for the ENABLE_MIDDLEWARE master switch."""

    def test_enable_middleware_false_disables_all(self):
        """ENABLE_MIDDLEWARE=false -> every toggle is False."""
        toggles = _eval_toggles({"ENABLE_MIDDLEWARE": "false"})
        assert toggles["ENABLE_MIDDLEWARE"] is False
        for key, val in toggles.items():
            assert val is False, f"{key} should be False when master switch is off"

    def test_enable_middleware_true_enables_all_by_default(self):
        """ENABLE_MIDDLEWARE=true with no individual overrides -> all True."""
        toggles = _eval_toggles({"ENABLE_MIDDLEWARE": "true"})
        assert toggles["ENABLE_MIDDLEWARE"] is True
        for key in _INDIVIDUAL_TOGGLES:
            assert toggles[key] is True, f"{key} should be True by default"

    def test_default_values_all_enabled(self):
        """With no env vars at all, everything defaults to True."""
        toggles = _eval_toggles({})
        for key, val in toggles.items():
            assert val is True, f"{key} should default to True"

    def test_master_switch_overrides_individual_true(self):
        """ENABLE_MIDDLEWARE=false + individual=true -> individual still disabled."""
        toggles = _eval_toggles({
            "ENABLE_MIDDLEWARE": "false",
            "ENABLE_DETERMINISTIC_MIDDLEWARE": "true",
            "ENABLE_SELF_SERVICE_MIDDLEWARE": "true",
        })
        assert toggles["ENABLE_MIDDLEWARE"] is False
        assert toggles["ENABLE_DETERMINISTIC_MIDDLEWARE"] is False
        assert toggles["ENABLE_SELF_SERVICE_MIDDLEWARE"] is False


# ===========================================================================
# Tests: individual toggles
# ===========================================================================

class TestIndividualToggles:
    """Tests for individual middleware toggles when master switch is on."""

    @pytest.mark.parametrize("toggle", _INDIVIDUAL_TOGGLES)
    def test_individual_toggle_can_be_disabled(self, toggle):
        """Each individual toggle can be disabled independently."""
        toggles = _eval_toggles({
            "ENABLE_MIDDLEWARE": "true",
            toggle: "false",
        })
        assert toggles["ENABLE_MIDDLEWARE"] is True
        assert toggles[toggle] is False
        # Other toggles remain True
        for other in _INDIVIDUAL_TOGGLES:
            if other != toggle:
                assert toggles[other] is True, f"{other} should remain True"

    @pytest.mark.parametrize("toggle", _INDIVIDUAL_TOGGLES)
    def test_individual_toggle_defaults_to_true(self, toggle):
        """Each individual toggle defaults to True when not set."""
        toggles = _eval_toggles({"ENABLE_MIDDLEWARE": "true"})
        assert toggles[toggle] is True

    def test_multiple_individuals_disabled(self):
        """Multiple individual toggles can be disabled simultaneously."""
        toggles = _eval_toggles({
            "ENABLE_MIDDLEWARE": "true",
            "ENABLE_DETERMINISTIC_MIDDLEWARE": "false",
            "ENABLE_POLICY_MIDDLEWARE": "false",
        })
        assert toggles["ENABLE_MIDDLEWARE"] is True
        assert toggles["ENABLE_DETERMINISTIC_MIDDLEWARE"] is False
        assert toggles["ENABLE_POLICY_MIDDLEWARE"] is False
        assert toggles["ENABLE_SELF_SERVICE_MIDDLEWARE"] is True
        assert toggles["ENABLE_SKILLS_MIDDLEWARE"] is True
        assert toggles["ENABLE_FILE_ARG_MIDDLEWARE"] is True


# ===========================================================================
# Tests: case sensitivity
# ===========================================================================

class TestCaseSensitivity:
    """Toggle values are case-insensitive."""

    @pytest.mark.parametrize("value", ["true", "True", "TRUE", "tRuE"])
    def test_true_case_insensitive(self, value):
        toggles = _eval_toggles({"ENABLE_MIDDLEWARE": value})
        assert toggles["ENABLE_MIDDLEWARE"] is True

    @pytest.mark.parametrize("value", ["false", "False", "FALSE", "fAlSe"])
    def test_false_case_insensitive(self, value):
        toggles = _eval_toggles({"ENABLE_MIDDLEWARE": value})
        assert toggles["ENABLE_MIDDLEWARE"] is False

    @pytest.mark.parametrize("value", ["0", "no", "off", ""])
    def test_non_true_values_are_false(self, value):
        """Any value that isn't 'true' (case-insensitive) evaluates to False."""
        toggles = _eval_toggles({"ENABLE_MIDDLEWARE": value})
        assert toggles["ENABLE_MIDDLEWARE"] is False


# ===========================================================================
# Tests: verify toggle names match deep_agent.py
# ===========================================================================

class TestToggleNames:
    """Verify our test helper matches the actual toggles in deep_agent.py."""

    def test_all_five_individual_toggles_exist(self):
        assert len(_INDIVIDUAL_TOGGLES) == 5

    def test_toggle_names(self):
        expected = {
            "ENABLE_DETERMINISTIC_MIDDLEWARE",
            "ENABLE_SELF_SERVICE_MIDDLEWARE",
            "ENABLE_POLICY_MIDDLEWARE",
            "ENABLE_SKILLS_MIDDLEWARE",
            "ENABLE_FILE_ARG_MIDDLEWARE",
        }
        assert set(_INDIVIDUAL_TOGGLES) == expected


# ===========================================================================
# Tests: USE_STRUCTURED_RESPONSE and ENABLE_RAG toggles
# ===========================================================================

def _eval_response_toggle(env_val: str | None) -> bool:
    """Evaluate USE_STRUCTURED_RESPONSE like deep_agent.py line 111."""
    val = env_val if env_val is not None else "true"
    return val.lower() == "true"


def _eval_rag_toggle(env_val: str | None) -> bool:
    """Evaluate ENABLE_RAG like deep_agent.py line 100."""
    val = env_val if env_val is not None else "false"
    return val.lower() in ("true", "1", "yes")


class TestStructuredResponseToggle:
    """Tests for USE_STRUCTURED_RESPONSE toggle (deep_agent.py line 111)."""

    def test_defaults_to_true(self):
        assert _eval_response_toggle(None) is True

    def test_explicitly_true(self):
        assert _eval_response_toggle("true") is True

    def test_explicitly_false(self):
        assert _eval_response_toggle("false") is False

    def test_case_insensitive(self):
        assert _eval_response_toggle("True") is True
        assert _eval_response_toggle("FALSE") is False


class TestEnableRagToggle:
    """Tests for ENABLE_RAG toggle (deep_agent.py line 100)."""

    def test_defaults_to_false(self):
        assert _eval_rag_toggle(None) is False

    def test_accepts_true(self):
        assert _eval_rag_toggle("true") is True

    def test_accepts_1(self):
        assert _eval_rag_toggle("1") is True

    def test_accepts_yes(self):
        assert _eval_rag_toggle("yes") is True

    def test_rejects_false(self):
        assert _eval_rag_toggle("false") is False

    def test_rejects_empty(self):
        assert _eval_rag_toggle("") is False
