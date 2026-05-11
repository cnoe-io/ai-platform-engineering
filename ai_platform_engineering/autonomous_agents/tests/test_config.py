# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for ``Settings`` validation (A2A retry/timeout + CORS safety)."""

import pydantic
import pytest

from autonomous_agents.config import Settings


class TestA2ASettings:
    """Defaults and bounds for the A2A retry/timeout fields."""

    def test_a2a_settings_have_sensible_defaults(self):
        """Defaults match the documented production values."""
        s = Settings()
        assert s.a2a_timeout_seconds == 300.0
        assert s.a2a_max_retries == 3
        assert s.a2a_retry_backoff_initial_seconds == 1.0
        assert s.a2a_retry_backoff_max_seconds == 30.0

    def test_a2a_timeout_must_be_positive(self):
        """``a2a_timeout_seconds`` must be strictly positive."""
        for bad in (0, -1, -0.5):
            with pytest.raises(pydantic.ValidationError):
                Settings(a2a_timeout_seconds=bad)

    def test_a2a_max_retries_must_be_non_negative(self):
        """``a2a_max_retries`` rejects negatives but accepts 0."""
        with pytest.raises(pydantic.ValidationError):
            Settings(a2a_max_retries=-1)
        assert Settings(a2a_max_retries=0).a2a_max_retries == 0

    def test_a2a_backoff_max_must_be_positive(self):
        """``a2a_retry_backoff_max_seconds`` must be strictly positive."""
        for bad in (0, -1):
            with pytest.raises(pydantic.ValidationError):
                Settings(a2a_retry_backoff_max_seconds=bad)

    def test_a2a_settings_reject_inf_and_nan(self):
        """``inf`` / ``-inf`` / ``nan`` are rejected on timeout and backoff_max."""
        for bad in (float("inf"), float("-inf"), float("nan")):
            with pytest.raises(pydantic.ValidationError):
                Settings(a2a_timeout_seconds=bad)
            with pytest.raises(pydantic.ValidationError):
                Settings(a2a_retry_backoff_max_seconds=bad)


class TestCorsOrigins:
    """``cors_origins`` parsing and wildcard rejection."""

    def test_cors_origins_default_is_empty(self):
        """No origins by default; production must opt in explicitly."""
        assert Settings().cors_origins == []

    def test_cors_origins_accepts_explicit_list(self):
        """A list of origins is stored verbatim."""
        s = Settings(cors_origins=["http://localhost:3000", "https://app.example.com"])
        assert s.cors_origins == ["http://localhost:3000", "https://app.example.com"]

    def test_cors_origins_parses_comma_separated_string(self):
        """Comma-separated env strings are split into a list."""
        s = Settings(cors_origins="http://localhost:3000, https://app.example.com")
        assert s.cors_origins == ["http://localhost:3000", "https://app.example.com"]

    def test_cors_origins_rejects_wildcard_alone(self):
        """``*`` is rejected (incompatible with ``allow_credentials=True``)."""
        with pytest.raises(pydantic.ValidationError):
            Settings(cors_origins=["*"])

    def test_cors_origins_rejects_wildcard_in_mixed_list(self):
        """Even one ``*`` in a mixed list is rejected."""
        with pytest.raises(pydantic.ValidationError):
            Settings(cors_origins=["http://localhost:3000", "*"])

    def test_cors_origins_empty_env_string_does_not_crash(self, monkeypatch):
        """``CORS_ORIGINS=`` is treated as ``no origins``, not a parse error."""
        monkeypatch.setenv("CORS_ORIGINS", "")
        s = Settings()
        assert s.cors_origins == []

    def test_cors_origins_json_array_in_raw_string(self):
        """``cors_origins_raw`` accepts a JSON array."""
        s = Settings(cors_origins_raw='["http://localhost:3000"]')
        assert s.cors_origins == ["http://localhost:3000"]
