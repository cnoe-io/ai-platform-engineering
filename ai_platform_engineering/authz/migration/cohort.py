"""Language-neutral deterministic canary cohort selection."""

from __future__ import annotations

import hashlib
import hmac


def cohort_bucket(
    *,
    seed: str,
    revision: str,
    surface: str,
    subject: str,
    resource_type: str,
    resource_id: str,
    action: str,
) -> int:
    message = "\x1f".join(
        (revision, surface, subject, resource_type, resource_id, action)
    ).encode()
    digest = hmac.new(seed.encode(), message, hashlib.sha256).digest()
    return int.from_bytes(digest[:8], "big") % 10000


def in_canary(*, percent: float, **inputs: str) -> bool:
    if not 0 <= percent <= 100:
        raise ValueError("canary percent must be between 0 and 100")
    return cohort_bucket(**inputs) < round(percent * 100)
