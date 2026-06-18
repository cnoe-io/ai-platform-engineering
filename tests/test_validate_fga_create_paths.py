"""Unit tests for scripts/validate-fga-create-paths.py.

Spec 2026-06-04-fga-coverage-guarantee, Layer 3. Tests the pure helpers against
fixtures and verifies main() passes against the real (correctly-wired) repo.

assisted-by Cursor claude-opus-4.8
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "validate-fga-create-paths.py"
spec = importlib.util.spec_from_file_location("validate_fga_create_paths", SCRIPT)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
# Register before exec so @dataclass annotation resolution (sys.modules lookup) works.
sys.modules["validate_fga_create_paths"] = mod
spec.loader.exec_module(mod)


@pytest.mark.parametrize(
    "path",
    [
        "ui/src/app/api/foo/__tests__/route.test.ts",
        "ui/src/lib/rbac/x.test.ts",
        "ai_platform_engineering/x/tests/test_y.py",
        "ai_platform_engineering/x/test_y.py",
        "ui/src/app/api/foo/route.spec.ts",
    ],
)
def test_is_test_file_true(path: str) -> None:
    assert mod._is_test_file(Path(path)) is True


@pytest.mark.parametrize(
    "path",
    [
        "ui/src/app/api/llm-models/route.ts",
        "ui/src/lib/rbac/openfga-owned-resources.ts",
        "ai_platform_engineering/knowledge_bases/rag/server/src/server/restapi.py",
    ],
)
def test_is_test_file_false(path: str) -> None:
    assert mod._is_test_file(Path(path)) is False


def test_known_reconcile_symbol_is_defined() -> None:
    assert mod._symbol_defined("reconcileLlmModelRelationships") is True


def test_unknown_symbol_is_not_defined() -> None:
    assert mod._symbol_defined("reconcileNonExistentResourceXyz") is False


def test_every_ownable_type_has_a_production_call_site() -> None:
    for ot in mod.OWNABLE_TYPES:
        sites: list[str] = []
        for sym in ot.symbols:
            sites.extend(mod._find_call_sites(sym, ot.call_globs))
        assert sites, f"{ot.resource_type}: expected a production call site, found none"


def test_main_passes_against_real_repo(monkeypatch: pytest.MonkeyPatch) -> None:
    # main() uses argparse, which reads sys.argv — isolate it from pytest's argv.
    monkeypatch.setattr(sys, "argv", ["validate-fga-create-paths.py"])
    assert mod.main() == 0
