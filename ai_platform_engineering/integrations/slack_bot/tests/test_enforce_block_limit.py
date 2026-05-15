"""Tests for enforce_block_limit() in slack_formatter.py."""

from ai_platform_engineering.integrations.slack_bot.utils.slack_formatter import (
  SLACK_MAX_BLOCKS,
  enforce_block_limit,
)


def _make_blocks(n, prefix="content"):
  return [{"type": "section", "id": f"{prefix}_{i}"} for i in range(n)]


class TestEnforceBlockLimit:
  """enforce_block_limit truncates content blocks to stay within Slack's 50-block cap."""

  def test_under_limit_returns_all(self):
    content = _make_blocks(10)
    footer = _make_blocks(2, "footer")
    result = enforce_block_limit(content, footer)
    assert len(result) == 12
    assert result[:10] == content
    assert result[10:] == footer

  def test_exactly_at_limit(self):
    content = _make_blocks(48)
    footer = _make_blocks(2, "footer")
    result = enforce_block_limit(content, footer)
    assert len(result) == 50
    assert result[-2:] == footer

  def test_over_limit_truncates_with_notice(self):
    content = _make_blocks(55)
    footer = _make_blocks(2, "footer")
    result = enforce_block_limit(content, footer)
    assert len(result) == SLACK_MAX_BLOCKS
    # Last 2 are footer
    assert result[-2:] == footer
    # Second-to-last before footer is truncation notice
    truncation = result[-3]
    assert truncation["type"] == "context"
    assert "truncated" in truncation["elements"][0]["text"]
    # Content is 50 - 2 footer - 1 notice = 47
    assert result[:47] == content[:47]

  def test_empty_content(self):
    footer = _make_blocks(2, "footer")
    result = enforce_block_limit([], footer)
    assert result == footer

  def test_empty_footer(self):
    content = _make_blocks(55)
    result = enforce_block_limit(content, [])
    assert len(result) == SLACK_MAX_BLOCKS
    assert "truncated" in result[-1]["elements"][0]["text"]
    assert result[:49] == content[:49]
