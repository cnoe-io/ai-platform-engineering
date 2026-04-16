import tempfile

import pytest

from ai_platform_engineering.integrations.slack_bot.utils.config_models import Config


class TestSilenceEnv:
  def test_silence_env_true(self, monkeypatch):
    monkeypatch.setenv("SLACK_INTEGRATION_SILENCE_ENV", "true")
    cfg = Config.from_env()
    assert cfg.silence_env is True

  def test_silence_env_false(self, monkeypatch):
    monkeypatch.setenv("SLACK_INTEGRATION_SILENCE_ENV", "false")
    cfg = Config.from_env()
    assert cfg.silence_env is False

  def test_silence_env_default(self, monkeypatch):
    monkeypatch.delenv("SLACK_INTEGRATION_SILENCE_ENV", raising=False)
    cfg = Config.from_env()
    assert cfg.silence_env is False  # Default is false


class TestChannelIDToJira:
  def test_config_valid_json(self):
    # Uses default from conftest
    cfg = Config.from_env()
    assert "C123" in cfg.channels
    assert cfg.channels["C123"].other.jira.project_key == "TEST"

  def test_config_missing_env_var_raises(self, monkeypatch):
    monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
    monkeypatch.delenv("CAIPE_BOT_CONFIG", raising=False)
    with pytest.raises(ValueError, match="not set"):
      Config.from_env()

  def test_config_invalid_json_raises(self, monkeypatch):
    monkeypatch.setenv("SLACK_INTEGRATION_BOT_CONFIG", "invalid json{")
    with pytest.raises(Exception):  # JSON decode error
      Config.from_env()

  def test_config_loaded_from_file_path(self, monkeypatch):
    yaml_content = """
C456:
  name: "#file-channel"
  ai_enabled: "true"
  qanda:
    enabled: "true"
  ai_alerts:
    enabled: "false"
  default: {}
"""
    monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
      f.write(yaml_content)
      f.flush()
      monkeypatch.setenv("CAIPE_BOT_CONFIG", f.name)
      cfg = Config.from_env()
    assert "C456" in cfg.channels
    assert cfg.channels["C456"].name == "#file-channel"

  def test_config_without_other_uses_defaults(self, monkeypatch):
    monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
    monkeypatch.setenv(
      "CAIPE_BOT_CONFIG",
      '{"C123": {"name": "#test-channel", "ai_enabled": "true", "qanda": {"enabled": "false"}, "ai_alerts": {"enabled": "false"}}}',
    )
    cfg = Config.from_env()
    assert cfg.channels["C123"].other is not None
    assert cfg.channels["C123"].other.jira is None  # No jira config by default

  def test_config_with_qanda_overthink(self, monkeypatch):
    """Q&A config preserves overthink flag (prompt logic moved to agent config)."""
    monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
    monkeypatch.setenv(
      "CAIPE_BOT_CONFIG",
      '{"C123": {"name": "#test-channel", "ai_enabled": "true", "qanda": {"enabled": "true", "overthink": true}, "ai_alerts": {"enabled": "false"}, "other": {"jira": {"project_key": "TEST"}}}}',
    )
    cfg = Config.from_env()
    assert cfg.channels["C123"].qanda.overthink is True

  def test_config_loads_channels(self):
    # Uses default from conftest
    cfg = Config.from_env()
    assert "C123" in cfg.channels
    assert cfg.channels["C123"].ai_enabled is True
    assert cfg.channels["C123"].qanda.enabled is False
    assert cfg.channels["C123"].ai_alerts.enabled is False

  def test_config_preserves_explicit_values(self, monkeypatch):
    monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
    monkeypatch.setenv(
      "CAIPE_BOT_CONFIG",
      '{"C123": {"name": "#test-channel", "ai_enabled": "true", "qanda": {"enabled": "true"}, "ai_alerts": {"enabled": "false"}, "other": {"jira": {"project_key": "TEST"}}}}',
    )
    cfg = Config.from_env()
    assert "C123" in cfg.channels
    assert cfg.channels["C123"].ai_enabled is True
    assert cfg.channels["C123"].qanda.enabled is True

  def test_config_include_bots(self, monkeypatch):
    monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
    monkeypatch.setenv(
      "CAIPE_BOT_CONFIG",
      '{"C123": {"name": "#test-channel", "ai_enabled": "true", "qanda": {"enabled": "true", "include_bots": {"enabled": "true", "bot_list": ["Bot1", "Bot2"]}}, "ai_alerts": {"enabled": "false"}, "other": {"jira": {"project_key": "TEST"}}}}',
    )
    cfg = Config.from_env()
    assert cfg.channels["C123"].qanda.include_bots.enabled is True
    assert cfg.channels["C123"].qanda.include_bots.bot_list == ["Bot1", "Bot2"]

  def test_config_mutual_exclusivity_validation(self, monkeypatch):
    # Both ai_alerts and qanda.include_bots enabled should raise error
    monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
    monkeypatch.setenv(
      "CAIPE_BOT_CONFIG",
      '{"C123": {"name": "#test-channel", "ai_enabled": "true", "qanda": {"enabled": "true", "include_bots": {"enabled": "true"}}, "ai_alerts": {"enabled": "true"}, "other": {"jira": {"project_key": "TEST"}}}}',
    )
    with pytest.raises(Exception, match="Cannot enable both"):
      Config.from_env()
