#!/usr/bin/env python3
"""Validate that every ownable resource type writes OpenFGA ownership tuples.

Spec 2026-06-04-fga-coverage-guarantee, Layer 3 — the "create-path ownership
linter". It guards against the most common ungated-resource bug: a create/update
path that persists a resource but forgets to write the ownership/share tuples that
make ReBAC checks work.

What it checks
--------------
For every ownable resource type, the named tuple-write / reconcile helper MUST be:
  1. DEFINED somewhere in the codebase (the helper exists), and
  2. CALLED from at least one PRODUCTION (non-test) file under its search globs.

If a helper is missing or only referenced from tests, the type's create path is
considered ungated and the linter fails. Adding a new ownable type therefore forces
a wired ownership-write before CI passes.

This intentionally does NOT try to statically prove every POST handler is covered
(high false-positive rate); it asserts the authoritative write path for each ownable
type exists and is wired, which is the property that actually prevents the bug.

Usage:
  python3 scripts/validate-fga-create-paths.py            # exit non-zero on drift
  python3 scripts/validate-fga-create-paths.py --print    # also print call sites

assisted-by Cursor claude-opus-4.8
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class OwnableType:
    """An ownable resource type and the helper that writes its ownership tuples."""

    resource_type: str
    # Any of these symbols counts as wiring the ownership write for this type.
    symbols: tuple[str, ...]
    # Globs (relative to repo root) where a production call site is expected.
    call_globs: tuple[str, ...]


# The set of group-owned, share-with-teams resources whose CREATE path must write
# ownership tuples. Keep in sync with the shareable template in deploy/openfga/model.fga
# and the enforcement manifest (ui/src/lib/rbac/fga-enforcement-manifest.ts).
OWNABLE_TYPES: tuple[OwnableType, ...] = (
    OwnableType(
        "knowledge_base",
        ("reconcileKnowledgeBaseRelationships",),
        ("ui/src/app/api/**/route.ts",),
    ),
    OwnableType(
        "data_source",
        ("reconcileDataSourceRelationships", "write_datasource_ownership"),
        ("ui/src/app/api/**/route.ts", "ai_platform_engineering/**/restapi.py"),
    ),
    OwnableType(
        "mcp_tool",
        ("reconcileMcpToolRelationships", "reconcileMcpToolForOwnership"),
        ("ui/src/app/api/**/route.ts",),
    ),
    OwnableType(
        "agent",
        ("reconcileAgentRelationships",),
        ("ui/src/app/api/**/route.ts",),
    ),
    OwnableType(
        "mcp_server",
        ("reconcileMcpServerRelationships",),
        ("ui/src/app/api/**/route.ts",),
    ),
    OwnableType(
        "llm_model",
        ("reconcileLlmModelRelationships",),
        ("ui/src/app/api/**/route.ts",),
    ),
)


@dataclass
class TypeResult:
    resource_type: str
    defined: bool = False
    call_sites: list[str] = field(default_factory=list)


def _is_test_file(path: Path) -> bool:
    parts = set(path.parts)
    name = path.name
    return (
        "__tests__" in parts
        or "tests" in parts
        or ".test." in name
        or ".spec." in name
        or name.endswith("_test.py")
        or name.startswith("test_")
    )


def _symbol_defined(symbol: str) -> bool:
    """True if `symbol` is defined (function/const) anywhere in TS or Python source."""
    # TS: `export function reconcileX` / `export const reconcileX` / `function reconcileX`
    # PY: `def write_datasource_ownership(`
    ts_def = re.compile(rf"(?:export\s+)?(?:async\s+)?function\s+{re.escape(symbol)}\b|"
                        rf"(?:export\s+)?const\s+{re.escape(symbol)}\b")
    py_def = re.compile(rf"(?:async\s+)?def\s+{re.escape(symbol)}\s*\(")
    for glob in ("ui/src/**/*.ts", "ai_platform_engineering/**/*.py"):
        for path in REPO_ROOT.glob(glob):
            if _is_test_file(path):
                continue
            try:
                content = path.read_text()
            except (UnicodeDecodeError, PermissionError):
                continue
            if path.suffix == ".py":
                if py_def.search(content):
                    return True
            elif ts_def.search(content):
                return True
    return False


def _find_call_sites(symbol: str, globs: tuple[str, ...]) -> list[str]:
    """Return production (non-test) `file:line` sites that CALL `symbol`."""
    call_re = re.compile(rf"\b{re.escape(symbol)}\s*\(")
    sites: list[str] = []
    for glob in globs:
        for path in REPO_ROOT.glob(glob):
            if _is_test_file(path):
                continue
            try:
                content = path.read_text()
            except (UnicodeDecodeError, PermissionError):
                continue
            for m in call_re.finditer(content):
                line_no = content[: m.start()].count("\n") + 1
                sites.append(f"{path.relative_to(REPO_ROOT)}:{line_no}")
    return sites


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--print", action="store_true", help="print discovered call sites")
    args = parser.parse_args()

    print("[validate-fga-create-paths] checking ownership-write wiring per ownable type…")
    results: list[TypeResult] = []
    violations: list[str] = []

    for ot in OWNABLE_TYPES:
        res = TypeResult(ot.resource_type)
        res.defined = any(_symbol_defined(sym) for sym in ot.symbols)
        for sym in ot.symbols:
            res.call_sites.extend(_find_call_sites(sym, ot.call_globs))
        results.append(res)

        if not res.defined:
            violations.append(
                f"  [missing_helper] {ot.resource_type}: none of {list(ot.symbols)} is defined in source"
            )
        if not res.call_sites:
            violations.append(
                f"  [unwired_create_path] {ot.resource_type}: no PRODUCTION call site for "
                f"{list(ot.symbols)} — a create/update path may persist this resource without "
                f"writing OpenFGA ownership tuples"
            )

    if args.print:
        for res in results:
            head = res.call_sites[0] if res.call_sites else "(none)"
            extra = f" (+{len(res.call_sites) - 1} more)" if len(res.call_sites) > 1 else ""
            print(f"  - {res.resource_type}: defined={res.defined} call={head}{extra}")

    if violations:
        print(
            f"\n[validate-fga-create-paths] FAIL — {len(violations)} violation(s):",
            file=sys.stderr,
        )
        for v in violations:
            print(v, file=sys.stderr)
        print(
            "\nFix: wire the resource's ownership-write helper (reconcile*Relationships / "
            "write_*_ownership) into its create/update route, or update OWNABLE_TYPES if the "
            "helper was renamed.",
            file=sys.stderr,
        )
        return 1

    print(f"[validate-fga-create-paths] OK — {len(OWNABLE_TYPES)} ownable types wired")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
