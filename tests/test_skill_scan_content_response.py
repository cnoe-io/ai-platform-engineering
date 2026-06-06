# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
# assisted-by Codex Codex-sonnet-4-6

"""Tests for sanitized skill scan-content responses."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))


def test_scan_response_helpers_accept_only_bounded_values() -> None:
    import ai_platform_engineering.skills_middleware.router as router_module

    assert router_module._safe_scan_severity(" HIGH ") == "high"
    assert router_module._safe_scan_severity("Traceback: secret high") is None
    assert router_module._safe_scan_severity(None) is None
    assert router_module._safe_scan_exit_code(1) == 1
    assert router_module._safe_scan_exit_code(True) is None
    assert router_module._safe_scan_exit_code("1") is None


def test_scan_content_response_omits_raw_scanner_output(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import ai_platform_engineering.skills_middleware.hub_skill_scan as hub_skill_scan
    import ai_platform_engineering.skills_middleware.router as router_module
    import ai_platform_engineering.skills_middleware.skill_scanner_runner as scanner_runner

    scan_root = tmp_path / "scan-root"
    scan_root.mkdir()
    persisted: dict[str, object] = {}
    raw_result = {
        "skipped": False,
        "exit_code": 1,
        "max_severity": "HIGH",
        "stdout": "Traceback with secret-token",
        "stderr": "password=super-secret",
        "duration_sec": 0.1,
    }
    monkeypatch.setenv("SKILL_SCANNER_GATE", "strict")
    monkeypatch.setenv("SKILL_SCANNER_FAIL_ON", "medium")
    monkeypatch.setattr(scanner_runner, "write_single_skill_to_temp_tree", lambda name, content: scan_root)
    monkeypatch.setattr(scanner_runner, "run_scan_all_on_directory", lambda root: raw_result)
    monkeypatch.setattr(
        hub_skill_scan,
        "_persist_scan_run",
        lambda config_id, result, **kwargs: persisted.update(
            {"config_id": config_id, "result": result, "kwargs": kwargs}
        ),
    )

    response = asyncio.run(
        router_module.scan_skill_content(
            router_module.ScanContentBody(name="unsafe", content="# skill", config_id="cfg-1"),
            router_module.CatalogAuthContext(bypass_entitlement=True),
        )
    )

    assert response == {
        "passed": False,
        "blocked": True,
        "scan_status": "flagged",
        "max_severity": "high",
        "exit_code": 1,
        "summary": "skill-scanner reported findings up to high severity",
    }
    assert "Traceback" not in str(response)
    assert "secret-token" not in str(response)
    assert "super-secret" not in str(response)
    assert persisted["config_id"] == "cfg-1"
