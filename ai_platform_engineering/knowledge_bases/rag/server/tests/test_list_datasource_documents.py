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


class TestListDatasourceDocuments:
  """Unit tests for list_datasource_documents endpoint count logic."""

  @pytest.mark.asyncio
  async def test_list_datasource_documents_empty_result_returns_zero_counts(self, monkeypatch: pytest.MonkeyPatch) -> None:
    """Empty result list from Milvus returns total_documents = 0 and total_chunks = 0."""
    from unittest.mock import AsyncMock, MagicMock
    import server.restapi as restapi
    from common.models.server import DatasourceDocumentsResponse

    mock_vector_db = MagicMock()
    mock_vector_db.client.query.return_value = []
    monkeypatch.setattr(restapi, "vector_db", mock_vector_db)
    monkeypatch.setattr(restapi, "check_datasource_access", AsyncMock())

    resp: DatasourceDocumentsResponse = await restapi.list_datasource_documents(
      request=MagicMock(),
      datasource_id="ds1",
      offset=0,
      limit=10,
    )

    assert resp.total_chunks == 0
    assert resp.total_documents == 0
    assert resp.documents == []
    assert resp.has_more is False

  @pytest.mark.asyncio
  async def test_list_datasource_documents_milvus_error_raises_500(self, monkeypatch: pytest.MonkeyPatch) -> None:
    """Exception during Milvus count query raises HTTP 500 fast-fail."""
    from unittest.mock import AsyncMock, MagicMock
    import server.restapi as restapi

    def query_side_effect(*args, **kwargs):
      output_fields = kwargs.get("output_fields", [])
      if "count(*)" in output_fields:
        raise RuntimeError("Milvus count query failed")
      return []

    mock_vector_db = MagicMock()
    mock_vector_db.client.query.side_effect = query_side_effect
    monkeypatch.setattr(restapi, "vector_db", mock_vector_db)
    monkeypatch.setattr(restapi, "check_datasource_access", AsyncMock())

    with pytest.raises(HTTPException) as exc_info:
      await restapi.list_datasource_documents(
        request=MagicMock(),
        datasource_id="ds1",
        offset=0,
        limit=10,
      )

    assert exc_info.value.status_code == 500
    assert "Failed to compute total_documents/total_chunks from Milvus" in exc_info.value.detail
