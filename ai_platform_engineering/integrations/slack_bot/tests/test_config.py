import tempfile

import pytest

from ai_platform_engineering.integrations.slack_bot.utils.config_models import (
  AgentBinding,
  BotsConfig,
  Config,
  EscalationConfig,
  OverthinkConfig,
  UsersConfig,
  VictorOpsEscalation,
  get_escalation_config,
)


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


class TestChannelWithAgentsList:
  def test_channel_with_agents_parses(self):
    # Uses default from conftest
    cfg = Config.from_env()
    assert "C123" in cfg.channels
    ch = cfg.channels["C123"]
    assert ch.name == "#test-channel"
    assert len(ch.agents) == 1
    assert ch.agents[0].agent_id == "test-agent"
    assert ch.agents[0].enable_users is not None
    assert ch.agents[0].enable_users.enabled is True

  def test_config_missing_env_var_returns_empty(self, monkeypatch):
    monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
    cfg = Config.from_env()
    assert cfg.channels == {}

  def test_config_invalid_json_raises(self, monkeypatch):
    monkeypatch.setenv("SLACK_INTEGRATION_BOT_CONFIG", "invalid json{")
    with pytest.raises(Exception):
      Config.from_env()

  def test_config_loaded_from_file_path(self, monkeypatch):
    yaml_content = """
C456:
  name: "#file-channel"
  agents:
    - agent_id: "file-agent"
      enable_users:
        enabled: true
"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
      f.write(yaml_content)
      f.flush()
      monkeypatch.setenv("SLACK_INTEGRATION_BOT_CONFIG", f.name)
      cfg = Config.from_env()
    assert "C456" in cfg.channels
    assert cfg.channels["C456"].name == "#file-channel"
    assert cfg.channels["C456"].agents[0].agent_id == "file-agent"

  def test_empty_agents_list(self, monkeypatch):
    monkeypatch.setenv(
      "SLACK_INTEGRATION_BOT_CONFIG",
      '{"C123": {"name": "#empty", "agents": []}}',
    )
    cfg = Config.from_env()
    assert cfg.channels["C123"].agents == []

  def test_multiple_agents_per_channel(self, monkeypatch):
    yaml = """
C789:
  name: "#multi"
  agents:
    - agent_id: "user-agent"
      enable_users:
        enabled: true
    - agent_id: "bot-agent"
      enable_bots:
        enabled: true
        bot_list: ["AlertBot"]
"""
    monkeypatch.setenv("SLACK_INTEGRATION_BOT_CONFIG", yaml)
    cfg = Config.from_env()
    ch = cfg.channels["C789"]
    assert len(ch.agents) == 2
    assert ch.agents[0].agent_id == "user-agent"
    assert ch.agents[1].agent_id == "bot-agent"
    assert ch.agents[1].enable_bots.bot_list == ["AlertBot"]


class TestBotsUsersConfigWithOverthink:
  def test_bots_config_defaults(self):
    bc = BotsConfig()
    assert bc.enabled is True
    assert bc.overthink.enabled is False
    assert bc.bot_list is None

  def test_users_config_with_overthink(self):
    uc = UsersConfig(
      enabled=True,
      overthink=OverthinkConfig(enabled=True, skip_markers=["DEFER", "CUSTOM_SKIP"]),
    )
    assert uc.overthink.enabled is True
    assert uc.overthink.skip_markers == ["DEFER", "CUSTOM_SKIP"]

  def test_bots_config_with_bot_list(self):
    bc = BotsConfig(enabled=True, bot_list=["AlertBot", "MonitorBot"])
    assert bc.bot_list == ["AlertBot", "MonitorBot"]


class TestEscalationConfigOnBinding:
  def test_escalation_on_agent_binding(self):
    binding = AgentBinding(
      agent_id="test",
      escalation=EscalationConfig(
        victorops=VictorOpsEscalation(enabled=True, team="ops"),
        users=["U_ONCALL"],
        delete_admins=["U_ADMIN"],
      ),
    )
    esc = get_escalation_config(binding)
    assert esc is not None
    assert esc.victorops.enabled is True
    assert esc.victorops.team == "ops"
    assert esc.users == ["U_ONCALL"]
    assert esc.delete_admins == ["U_ADMIN"]

  def test_no_escalation_returns_none(self):
    binding = AgentBinding(agent_id="test")
    assert get_escalation_config(binding) is None

  def test_escalation_all_disabled_returns_none(self):
    binding = AgentBinding(
      agent_id="test",
      escalation=EscalationConfig(
        victorops=VictorOpsEscalation(enabled=False),
        users=[],
        emoji={"enabled": False, "name": "eyes"},
      ),
    )
    assert get_escalation_config(binding) is None

  def test_escalation_with_emoji_only(self):
    binding = AgentBinding(
      agent_id="test",
      escalation=EscalationConfig(
        emoji={"enabled": True, "name": "rotating_light"},
      ),
    )
    esc = get_escalation_config(binding)
    assert esc is not None
    assert esc.emoji.enabled is True
    assert esc.emoji.name == "rotating_light"


class TestOverthinkConfigDefaults:
  def test_defaults(self):
    oc = OverthinkConfig()
    assert oc.enabled is False
    assert oc.skip_markers == ["DEFER", "LOW_CONFIDENCE"]
    assert oc.pass_marker == "CONFIDENCE: HIGH"
    assert oc.custom_prompt is None
    assert oc.followup_prompt is None

  def test_custom_markers(self):
    oc = OverthinkConfig(
      enabled=True,
      skip_markers=["DEFER", "NOPE"],
      pass_marker="GO_AHEAD",
    )
    assert oc.skip_markers == ["DEFER", "NOPE"]
    assert oc.pass_marker == "GO_AHEAD"


class TestOldFormatDetection:
  def test_qanda_key_raises_value_error(self, monkeypatch):
    monkeypatch.setenv(
      "SLACK_INTEGRATION_BOT_CONFIG",
      '{"C123": {"name": "#old", "qanda": {"enabled": true}}}',
    )
    with pytest.raises(ValueError, match="pre-0.4.0"):
      Config.from_env()

  def test_ai_alerts_key_raises_value_error(self, monkeypatch):
    monkeypatch.setenv(
      "SLACK_INTEGRATION_BOT_CONFIG",
      '{"C123": {"name": "#old", "ai_alerts": {"enabled": true}}}',
    )
    with pytest.raises(ValueError, match="pre-0.4.0"):
      Config.from_env()

  def test_ai_enabled_key_raises_value_error(self, monkeypatch):
    monkeypatch.setenv(
      "SLACK_INTEGRATION_BOT_CONFIG",
      '{"C123": {"name": "#old", "ai_enabled": true}}',
    )
    with pytest.raises(ValueError, match="pre-0.4.0"):
      Config.from_env()
