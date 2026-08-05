"""Unit tests for list_datasource_documents endpoint and datasource_id validation in server.restapi."""

import pytest
from fastapi import HTTPException
from server.restapi import _validate_datasource_id


class TestValidateDatasourceId:
  """Unit tests for _validate_datasource_id helper."""

  def test_valid_datasource_ids(self) -> None:
    """Valid alphanumeric, dash, and underscore IDs pass validation."""
    valid_ids = [
      "ds1",
      "datasource-123",
      "my_datasource_name",
      "a" * 256,
    ]
    for ds_id in valid_ids:
      assert _validate_datasource_id(ds_id) == ds_id

  def test_invalid_datasource_ids_rejected(self) -> None:
    """Unsafe characters (quotes, SQL/expression injection, spaces) raise HTTP 400."""
    invalid_ids = [
      "ds1' OR '1'='1",
      "ds1; DROP TABLE docs;",
      "datasource name",
      "ds1/../etc",
      "",
      "a" * 257,
    ]
    for ds_id in invalid_ids:
      with pytest.raises(HTTPException) as exc_info:
        _validate_datasource_id(ds_id)
      assert exc_info.value.status_code == 400
      assert "Invalid datasource_id" in exc_info.value.detail
