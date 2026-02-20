"""
Tests for IngestorBuilder sync scheduling.

Covers:
1. Single-run mode (negative values like -1)
2. Periodic mode (.every(X) with X >= MIN_SYNC_INTERVAL)
3. Minimum sync interval clamping (0 and small positive values)
"""

from common.constants import MIN_SYNC_INTERVAL
from common.ingestor import IngestorBuilder


class TestIngestorBuilderScheduling:
  """Tests for IngestorBuilder scheduling configuration."""

  def test_default_is_single_run_mode(self):
    """By default, _sync_interval is 0 which gets clamped to MIN_SYNC_INTERVAL."""
    builder = IngestorBuilder()
    assert builder._sync_interval == 0  # Not yet set via .every()

  def test_every_sets_sync_interval(self):
    """every() sets _sync_interval to the specified value."""
    builder = IngestorBuilder()
    result = builder.every(600)
    assert builder._sync_interval == 600
    assert result is builder  # Returns self for chaining

  def test_every_negative_is_single_run(self):
    """every(-1) results in single-run mode."""
    builder = IngestorBuilder()
    builder.every(-1)
    assert builder._sync_interval == -1  # Negative = single-run mode

  def test_every_zero_clamps_to_min(self):
    """every(0) is clamped to MIN_SYNC_INTERVAL."""
    builder = IngestorBuilder()
    builder.every(0)
    assert builder._sync_interval == MIN_SYNC_INTERVAL

  def test_every_small_positive_clamps_to_min(self):
    """Values below MIN_SYNC_INTERVAL are clamped up."""
    builder = IngestorBuilder()
    builder.every(10)  # Too low
    assert builder._sync_interval == MIN_SYNC_INTERVAL

  def test_every_at_min_sync_interval_not_clamped(self):
    """Values at exactly MIN_SYNC_INTERVAL are not changed."""
    builder = IngestorBuilder()
    builder.every(MIN_SYNC_INTERVAL)
    assert builder._sync_interval == MIN_SYNC_INTERVAL

  def test_every_above_min_sync_interval_not_clamped(self):
    """Values above MIN_SYNC_INTERVAL are not changed."""
    builder = IngestorBuilder()
    builder.every(MIN_SYNC_INTERVAL + 1)
    assert builder._sync_interval == MIN_SYNC_INTERVAL + 1

  def test_builder_chain(self):
    """Builder methods can be chained."""
    builder = IngestorBuilder().name("test").type("test-type").description("Test ingestor").metadata({"key": "value"}).every(300).with_init_delay(10)
    assert builder._name == "test"
    assert builder._type == "test-type"
    assert builder._description == "Test ingestor"
    assert builder._metadata == {"key": "value"}
    assert builder._sync_interval == 300
    assert builder._init_delay == 10
