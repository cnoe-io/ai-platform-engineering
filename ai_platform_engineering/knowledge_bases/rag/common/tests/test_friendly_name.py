"""Unit tests for derive_friendly_name / derive_friendly_name_from_url.

These helpers produce the human-readable display label for a datasource.
The label is ALWAYS for display only — `datasource_id` remains the stable
authorization/storage key. See `DataSourceInfo.name` for semantics.
"""

from common.utils import derive_friendly_name, derive_friendly_name_from_url


class TestDeriveFriendlyNameFromUrl:
  def test_simple_host_only(self):
    assert derive_friendly_name_from_url("https://example.com") == "example.com"

  def test_host_and_one_segment(self):
    assert derive_friendly_name_from_url("https://cnoe.io/docs") == "cnoe.io / docs"

  def test_host_and_two_segments_capped(self):
    label = derive_friendly_name_from_url("https://github.com/owner/repo/tree/main/docs")
    assert label == "github.com / owner/repo"

  def test_lowercases_host(self):
    assert derive_friendly_name_from_url("https://Example.COM/Foo") == "example.com / Foo"

  def test_caps_length(self):
    long_host = "x" * 200 + ".example.com"
    label = derive_friendly_name_from_url(f"https://{long_host}/path", max_length=40)
    assert len(label) <= 40
    assert label.endswith("\u2026")

  def test_garbage_url_falls_back_to_truncation(self):
    label = derive_friendly_name_from_url("not a url at all", max_length=20)
    assert len(label) <= 20


class TestDeriveFriendlyName:
  def test_confluence_uses_space_key(self):
    assert derive_friendly_name(source_type="confluence", space_key="ENG") == "Confluence: ENG"

  def test_jira_uses_project_key(self):
    assert derive_friendly_name(source_type="jira", project_key="PROJ") == "Jira: PROJ"

  def test_slack_uses_channel_name(self):
    assert derive_friendly_name(source_type="slack", channel_name="general") == "Slack: #general"

  def test_slack_strips_existing_hash(self):
    assert derive_friendly_name(source_type="slack", channel_name="#general") == "Slack: #general"

  def test_github_uses_repo(self):
    assert derive_friendly_name(source_type="github", repo="owner/repo") == "GitHub: owner/repo"

  def test_falls_through_to_url(self):
    label = derive_friendly_name(source_type="web", url="https://example.com/foo")
    assert label == "example.com / foo"

  def test_falls_back_to_fallback(self):
    assert derive_friendly_name(fallback="src_abc_123") == "src_abc_123"

  def test_empty_returns_sentinel(self):
    assert derive_friendly_name() == "untitled-datasource"

  def test_specific_signal_wins_over_url(self):
    label = derive_friendly_name(
      source_type="confluence",
      space_key="ENG",
      url="https://confluence.example.com/wiki/spaces/ENG",
    )
    assert label == "Confluence: ENG"
