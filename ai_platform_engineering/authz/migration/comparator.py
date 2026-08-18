"""Canonical legacy/Authz result comparison."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class MismatchClass(StrEnum):
    NONE = "NONE"
    ALLOW_DENY = "ALLOW_DENY"
    DENY_ALLOW = "DENY_ALLOW"
    ERROR_RESULT = "ERROR_RESULT"
    REASON_ONLY = "REASON_ONLY"
    LATENCY = "LATENCY"


@dataclass(frozen=True)
class ComparableDecision:
    allowed: bool
    reason_code: str
    duration_ms: float
    error: bool = False


def classify(
    legacy: ComparableDecision,
    authz: ComparableDecision,
    *,
    latency_delta_ms: float = 100.0,
) -> MismatchClass:
    if legacy.error or authz.error:
        return MismatchClass.ERROR_RESULT
    if legacy.allowed and not authz.allowed:
        return MismatchClass.ALLOW_DENY
    if not legacy.allowed and authz.allowed:
        return MismatchClass.DENY_ALLOW
    if legacy.reason_code != authz.reason_code:
        return MismatchClass.REASON_ONLY
    if abs(legacy.duration_ms - authz.duration_ms) > latency_delta_ms:
        return MismatchClass.LATENCY
    return MismatchClass.NONE
