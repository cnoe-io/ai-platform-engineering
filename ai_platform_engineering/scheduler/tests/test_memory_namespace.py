from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from caipe_scheduler.app import validate_memory_namespace
from caipe_scheduler.auth import CallerIdentity
from caipe_scheduler.config import Settings


CALLER = CallerIdentity(sub="sub-a", email="a@example.test", token="bearer")


def test_namespace_validation_forwards_caller_and_accepts_visible_key(monkeypatch) -> None:
  calls: list[tuple[str, dict]] = []

  def fake_get(url: str, **kwargs):
    calls.append((url, kwargs))
    return SimpleNamespace(
      status_code=200,
      json=lambda: {"data": {"items": [{"key": "pod-a"}], "allow_custom": False}},
    )

  monkeypatch.setattr("caipe_scheduler.app.httpx.get", fake_get)

  validate_memory_namespace("agent-a", "pod-a", CALLER, Settings())

  assert calls[0][1]["headers"] == {"Authorization": "Bearer bearer"}


def test_namespace_validation_fails_closed_for_invalid_or_unlisted_key(monkeypatch) -> None:
  with pytest.raises(HTTPException) as invalid:
    validate_memory_namespace("agent-a", "../pod", CALLER, Settings())
  assert invalid.value.status_code == 422

  monkeypatch.setattr(
    "caipe_scheduler.app.httpx.get",
    lambda *args, **kwargs: SimpleNamespace(
      status_code=200,
      json=lambda: {"data": {"items": [], "allow_custom": False}},
    ),
  )
  with pytest.raises(HTTPException) as unavailable:
    validate_memory_namespace("agent-a", "pod-a", CALLER, Settings())
  assert unavailable.value.status_code == 422
