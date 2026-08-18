from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from ai_platform_engineering.authz.migration.config import MigrationMode
from ai_platform_engineering.authz.migration.retirement import (
    LegacyRetirementSignals,
    evaluate_legacy_retirement,
)


NOW = datetime(2026, 8, 18, tzinfo=timezone.utc)


def signals(**overrides: object) -> LegacyRetirementSignals:
    values: dict[str, object] = {
        "scope_modes": (MigrationMode.AUTHZ_ONLY, MigrationMode.AUTHZ_ONLY),
        "authz_only_since": NOW - timedelta(days=14),
        "evaluated_at": NOW,
        "minimum_retention": timedelta(days=7),
        "rollback_release_available": True,
    }
    values.update(overrides)
    return LegacyRetirementSignals(**values)  # type: ignore[arg-type]


def test_legacy_removal_requires_every_scope_to_be_authz_only() -> None:
    result = evaluate_legacy_retirement(
        signals(scope_modes=(MigrationMode.AUTHZ_ONLY, MigrationMode.AUTHZ))
    )

    assert result.ready is False
    assert result.blockers == ("scopes_not_authz_only",)


@pytest.mark.parametrize(
    ("authz_only_since", "expected"),
    [
        (None, "authz_only_retention_not_started"),
        (NOW - timedelta(days=1), "authz_only_retention_incomplete"),
    ],
)
def test_legacy_removal_requires_completed_retention(
    authz_only_since: datetime | None,
    expected: str,
) -> None:
    result = evaluate_legacy_retirement(signals(authz_only_since=authz_only_since))

    assert result.ready is False
    assert expected in result.blockers


def test_legacy_removal_requires_a_compatible_release_rollback() -> None:
    result = evaluate_legacy_retirement(signals(rollback_release_available=False))

    assert result.ready is False
    assert result.blockers == ("compatible_rollback_release_missing",)


def test_legacy_removal_is_ready_only_after_all_preconditions() -> None:
    result = evaluate_legacy_retirement(signals())

    assert result.ready is True
    assert result.blockers == ()
