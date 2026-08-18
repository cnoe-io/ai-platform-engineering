"""Deployment gate for removing a legacy authorization evaluator."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from ai_platform_engineering.authz.migration.config import MigrationMode


@dataclass(frozen=True)
class LegacyRetirementSignals:
    """Evidence required before a surface may stop shipping its legacy evaluator."""

    scope_modes: tuple[MigrationMode, ...]
    authz_only_since: datetime | None
    evaluated_at: datetime
    minimum_retention: timedelta
    rollback_release_available: bool


@dataclass(frozen=True)
class LegacyRetirementResult:
    ready: bool
    blockers: tuple[str, ...]


def evaluate_legacy_retirement(signals: LegacyRetirementSignals) -> LegacyRetirementResult:
    """Require complete AUTHZ_ONLY coverage, retention, and a release rollback."""

    blockers: list[str] = []
    if not signals.scope_modes or any(mode is not MigrationMode.AUTHZ_ONLY for mode in signals.scope_modes):
        blockers.append("scopes_not_authz_only")
    if signals.authz_only_since is None:
        blockers.append("authz_only_retention_not_started")
    elif signals.evaluated_at - signals.authz_only_since < signals.minimum_retention:
        blockers.append("authz_only_retention_incomplete")
    if not signals.rollback_release_available:
        blockers.append("compatible_rollback_release_missing")
    return LegacyRetirementResult(ready=not blockers, blockers=tuple(blockers))
