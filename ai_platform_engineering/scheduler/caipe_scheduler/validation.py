"""Validators for incoming schedule requests."""

from __future__ import annotations

from croniter import croniter
from fastapi import HTTPException
from pytz import all_timezones_set


def validate_cron(expr: str) -> None:
  # Kubernetes CronJob accepts exactly five fields. croniter also supports
  # seconds/year variants, so constrain the grammar before asking croniter.
  fields = expr.split()
  if len(fields) != 5:
    raise HTTPException(400, "Cron must use exactly 5 fields: minute hour day-of-month month day-of-week.")
  if not croniter.is_valid(expr):
    raise HTTPException(400, f"Invalid cron expression: {expr!r}")


def validate_tz(tz: str) -> None:
  if tz not in all_timezones_set:
    raise HTTPException(400, f"Unknown timezone: {tz!r}")


def validate_message(msg: str, max_chars: int) -> None:
  if not msg or not msg.strip():
    raise HTTPException(400, "message_template must be non-empty.")
  if len(msg) > max_chars:
    raise HTTPException(400, f"message_template exceeds {max_chars} chars.")
