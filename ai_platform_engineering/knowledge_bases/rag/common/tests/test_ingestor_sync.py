"""
Tests for IngestorBuilder._calculate_next_sync_time.

Covers the sync scheduling logic which:
1. Calculates sleep time based on datasource reload intervals
2. Clamps the result to [MIN_SYNC_INTERVAL, MAX_SYNC_INTERVAL]
3. Uses DEFAULT_DATASOURCE_RELOAD_INTERVAL for datasources without explicit reload_interval
"""

import time
from unittest.mock import AsyncMock, patch

import pytest

from common.constants import (
  MIN_SYNC_INTERVAL,
  MAX_SYNC_INTERVAL,
)
from common.ingestor import IngestorBuilder
from common.models.rag import DataSourceInfo


def _make_datasource(
  datasource_id: str = "ds_1",
  last_updated: int | None = None,
  reload_interval: int | None = None,
) -> DataSourceInfo:
  metadata = {}
  if reload_interval is not None:
    metadata["reload_interval"] = reload_interval
  return DataSourceInfo(
    datasource_id=datasource_id,
    ingestor_id="webloader:default",
    source_type="web",
    last_updated=last_updated,
    metadata=metadata if metadata else None,
  )


def _make_builder(sync_interval: int = 600) -> IngestorBuilder:
  builder = IngestorBuilder()
  builder._sync_interval = sync_interval
  return builder


def _mock_client(datasources: list[DataSourceInfo]) -> AsyncMock:
  client = AsyncMock()
  client.ingestor_id = "webloader:default"
  client.list_datasources = AsyncMock(return_value=datasources)
  return client


class TestCalculateNextSyncTime:
  """Tests for IngestorBuilder._calculate_next_sync_time"""

  @pytest.mark.asyncio
  async def test_no_datasources_returns_max_sync_interval(self):
    """No datasources → return MAX_SYNC_INTERVAL to check again later."""
    builder = _make_builder()
    client = _mock_client([])
    sleep_time, has_ds = await builder._calculate_next_sync_time(client)
    assert sleep_time == MAX_SYNC_INTERVAL
    assert has_ds is False

  @pytest.mark.asyncio
  async def test_datasource_never_updated_returns_immediate(self):
    """Datasource with last_updated=None → immediate sync."""
    ds = _make_datasource(last_updated=None)
    builder = _make_builder()
    client = _mock_client([ds])
    sleep_time, has_ds = await builder._calculate_next_sync_time(client)
    assert sleep_time == 0
    assert has_ds is True

  @pytest.mark.asyncio
  async def test_datasource_overdue_returns_immediate(self):
    """Overdue datasource → immediate sync."""
    now = int(time.time())
    ds = _make_datasource(last_updated=now - 7200, reload_interval=3600)
    builder = _make_builder()
    client = _mock_client([ds])
    sleep_time, has_ds = await builder._calculate_next_sync_time(client)
    assert sleep_time == 0
    assert has_ds is True

  @pytest.mark.asyncio
  @patch("common.ingestor.MAX_SYNC_INTERVAL", 100000)
  async def test_no_metadata_uses_default_reload_interval_not_sync_interval(self):
    """Core bug fix: without reload_interval, use DEFAULT_DATASOURCE_RELOAD_INTERVAL (86400s),
    NOT sync_interval. Patches MAX higher to verify unclamped calculation."""
    now = int(time.time())
    ds = _make_datasource(last_updated=now - 3600)  # 1 hour ago
    builder = _make_builder(sync_interval=600)
    client = _mock_client([ds])
    sleep_time, has_ds = await builder._calculate_next_sync_time(client)
    # Should be ~82800s (86400 - 3600), NOT 0 (old bug: 600 - 3600 < 0)
    assert sleep_time > 80000
    assert has_ds is True

  @pytest.mark.asyncio
  async def test_sleep_clamped_to_min_sync_interval(self):
    """Small positive time_until_reload is clamped up to MIN_SYNC_INTERVAL."""
    now = int(time.time())
    ds = _make_datasource(last_updated=now - 3590, reload_interval=3600)  # 10s remaining
    builder = _make_builder()
    client = _mock_client([ds])
    sleep_time, has_ds = await builder._calculate_next_sync_time(client)
    assert sleep_time == MIN_SYNC_INTERVAL

  @pytest.mark.asyncio
  async def test_sleep_clamped_to_max_sync_interval(self):
    """Large time_until_reload is clamped down to MAX_SYNC_INTERVAL."""
    now = int(time.time())
    ds = _make_datasource(last_updated=now - 100, reload_interval=86400)  # 86300s remaining
    builder = _make_builder()
    client = _mock_client([ds])
    sleep_time, has_ds = await builder._calculate_next_sync_time(client)
    assert sleep_time == MAX_SYNC_INTERVAL
    assert has_ds is True

  @pytest.mark.asyncio
  async def test_sleep_within_bounds_not_clamped(self):
    """Sleep time within [MIN, MAX] is returned as-is."""
    now = int(time.time())
    ds = _make_datasource(last_updated=now - 200, reload_interval=500)  # 300s remaining
    builder = _make_builder()
    client = _mock_client([ds])
    sleep_time, has_ds = await builder._calculate_next_sync_time(client)
    assert 295 <= sleep_time <= 300
    assert has_ds is True

  @pytest.mark.asyncio
  async def test_multiple_datasources_picks_earliest(self):
    """With multiple datasources, use the earliest reload time."""
    now = int(time.time())
    ds1 = _make_datasource(datasource_id="ds_1", last_updated=now - 100, reload_interval=500)  # 400s
    ds2 = _make_datasource(datasource_id="ds_2", last_updated=now - 300, reload_interval=500)  # 200s
    builder = _make_builder()
    client = _mock_client([ds1, ds2])
    sleep_time, has_ds = await builder._calculate_next_sync_time(client)
    assert 195 <= sleep_time <= 200
    assert has_ds is True

  @pytest.mark.asyncio
  async def test_client_error_falls_back_to_max_sync_interval(self):
    """On error, fall back to MAX_SYNC_INTERVAL."""
    builder = _make_builder()
    client = _mock_client([])
    client.list_datasources = AsyncMock(side_effect=Exception("connection error"))
    sleep_time, has_ds = await builder._calculate_next_sync_time(client)
    assert sleep_time == MAX_SYNC_INTERVAL
    assert has_ds is False
