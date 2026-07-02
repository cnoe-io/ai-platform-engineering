import pytest
from fastapi import HTTPException

from caipe_scheduler.app import require_service_token
from caipe_scheduler.config import Settings


def test_service_token_auth_fails_closed_when_unconfigured():
  with pytest.raises(HTTPException) as exc_info:
    require_service_token(
      x_scheduler_token=None,
      settings=Settings(service_token=""),
    )

  assert exc_info.value.status_code == 503


def test_service_token_auth_rejects_wrong_token():
  with pytest.raises(HTTPException) as exc_info:
    require_service_token(
      x_scheduler_token="wrong",
      settings=Settings(service_token="expected"),
    )

  assert exc_info.value.status_code == 401


def test_service_token_auth_accepts_exact_token():
  assert (
    require_service_token(
      x_scheduler_token="expected",
      settings=Settings(service_token="expected"),
    )
    is None
  )
