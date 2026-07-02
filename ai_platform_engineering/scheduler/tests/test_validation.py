import pytest
from fastapi import HTTPException

from caipe_scheduler.validation import validate_cron


def test_validate_cron_accepts_kubernetes_five_field_expression():
  assert validate_cron("0 9 * * MON") is None


def test_validate_cron_rejects_non_kubernetes_six_field_expression():
  with pytest.raises(HTTPException) as exc_info:
    validate_cron("0 0 9 * * MON")

  assert exc_info.value.status_code == 400
  assert "exactly 5 fields" in str(exc_info.value.detail)
