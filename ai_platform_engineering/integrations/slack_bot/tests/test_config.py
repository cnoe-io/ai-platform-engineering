import pytest

from ai_platform_engineering.integrations.slack_bot.utils.config_models import (
    Config,
    EscalationConfig,
    OverthinkConfig,
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


class TestChannelIDToJira:
    def test_config_valid_json(self):
        # Uses default from conftest
        cfg = Config.from_env()
        assert "C123" in cfg.channels
        assert cfg.channels["C123"].default["project_key"] == "TEST"

    def test_config_missing_env_var_raises(self, monkeypatch):
        monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
        monkeypatch.delenv("CAIPE_BOT_CONFIG", raising=False)
        with pytest.raises(ValueError, match="not set"):
            Config.from_env()

    def test_config_invalid_json_raises(self, monkeypatch):
        monkeypatch.setenv("SLACK_INTEGRATION_BOT_CONFIG", "invalid json{")
        with pytest.raises(Exception):  # JSON decode error
            Config.from_env()

    def test_config_missing_default_raises(self, monkeypatch):
        monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
        monkeypatch.setenv(
            "CAIPE_BOT_CONFIG",
            '{"C123": {"name": "#test-channel", "ai_enabled": "true", "qanda": {"enabled": "false"}, "ai_alerts": {"enabled": "false"}}}',
        )
        with pytest.raises(Exception):  # Pydantic validation error - missing required field
            Config.from_env()

    def test_config_with_custom_prompt(self, monkeypatch):
        monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
        monkeypatch.setenv(
            "CAIPE_BOT_CONFIG",
            '{"C123": {"name": "#test-channel", "ai_enabled": "true", "qanda": {"enabled": "true", "custom_prompt": "Custom: {message_text}"}, "ai_alerts": {"enabled": "false"}, "default": {"project_key": "TEST"}}}',
        )
        cfg = Config.from_env()
        cfg.apply_defaults_to_channels()
        assert "C123" in cfg.channels
        # Custom prompt should have style instruction appended
        assert "Custom: {message_text}" in cfg.channels["C123"].qanda.custom_prompt
        assert cfg.defaults.response_style_instruction in cfg.channels["C123"].qanda.custom_prompt

    def test_config_applies_defaults(self):
        # Uses default from conftest - no custom prompt set
        cfg = Config.from_env()
        cfg.apply_defaults_to_channels()
        assert "C123" in cfg.channels
        # Verify explicit values
        assert cfg.channels["C123"].ai_enabled is True
        assert cfg.channels["C123"].qanda.enabled is False
        assert cfg.channels["C123"].ai_alerts.enabled is False
        # Verify default prompt is applied (without response_style_instruction - only added to custom prompts)
        assert cfg.channels["C123"].qanda.custom_prompt == cfg.defaults.default_qanda_prompt

    def test_config_preserves_explicit_values(self, monkeypatch):
        monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
        monkeypatch.setenv(
            "CAIPE_BOT_CONFIG",
            '{"C123": {"name": "#test-channel", "ai_enabled": "true", "qanda": {"enabled": "true", "custom_prompt": "test"}, "ai_alerts": {"enabled": "false"}, "default": {"project_key": "TEST"}}}',
        )
        cfg = Config.from_env()
        cfg.apply_defaults_to_channels()
        assert "C123" in cfg.channels
        # Verify explicit values are preserved
        assert cfg.channels["C123"].ai_enabled is True
        assert cfg.channels["C123"].qanda.enabled is True
        # Custom prompt should have style appended
        assert "test" in cfg.channels["C123"].qanda.custom_prompt
        assert cfg.defaults.response_style_instruction in cfg.channels["C123"].qanda.custom_prompt

    def test_config_include_bots(self, monkeypatch):
        monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
        monkeypatch.setenv(
            "CAIPE_BOT_CONFIG",
            '{"C123": {"name": "#test-channel", "ai_enabled": "true", "qanda": {"enabled": "true", "include_bots": {"enabled": "true", "bot_list": ["Bot1", "Bot2"]}}, "ai_alerts": {"enabled": "false"}, "default": {"project_key": "TEST"}}}',
        )
        cfg = Config.from_env()
        assert cfg.channels["C123"].qanda.include_bots.enabled is True
        assert cfg.channels["C123"].qanda.include_bots.bot_list == ["Bot1", "Bot2"]

    def test_config_with_channel_mention_custom_prompt(self, monkeypatch):
        monkeypatch.setenv(
            "SLACK_INTEGRATION_BOT_CONFIG",
            """
C123:
  name: "#test-channel"
  ai_enabled: true
  custom_prompt: "Channel prompt: {message_text}"
  qanda:
    enabled: false
  ai_alerts:
    enabled: false
  default:
    project_key: TEST
""",
        )
        cfg = Config.from_env()
        assert cfg.channels["C123"].custom_prompt == "Channel prompt: {message_text}"

    def test_config_channel_mention_custom_prompt_defaults_to_none(self):
        # Uses default from conftest - no custom_prompt set
        cfg = Config.from_env()
        assert cfg.channels["C123"].custom_prompt is None

    def test_config_mutual_exclusivity_validation(self, monkeypatch):
        # Both ai_alerts and qanda.include_bots enabled should raise error
        monkeypatch.delenv("SLACK_INTEGRATION_BOT_CONFIG", raising=False)
        monkeypatch.setenv(
            "CAIPE_BOT_CONFIG",
            '{"C123": {"name": "#test-channel", "ai_enabled": "true", "qanda": {"enabled": "true", "include_bots": {"enabled": "true"}}, "ai_alerts": {"enabled": "true"}, "default": {"project_key": "TEST"}}}',
        )
        with pytest.raises(Exception, match="Cannot enable both"):
            Config.from_env()

    def test_config_with_escalation(self, monkeypatch):
        monkeypatch.setenv(
            "SLACK_INTEGRATION_BOT_CONFIG",
            """
C123:
  name: "#test-channel"
  ai_enabled: true
  qanda:
    enabled: false
  ai_alerts:
    enabled: false
  default:
    project_key: TEST
    escalation:
      victorops:
        enabled: true
        team: platform-oncall
      users:
        - U987654
      emoji:
        enabled: true
        name: eyes
      delete_admins:
        - U111111
""",
        )
        cfg = Config.from_env()
        esc = get_escalation_config(cfg.channels["C123"].default)
        assert esc is not None
        assert esc.victorops.enabled is True
        assert esc.victorops.team == "platform-oncall"
        assert esc.users == ["U987654"]
        assert esc.emoji.name == "eyes"
        assert esc.delete_admins == ["U111111"]

    def test_get_escalation_config_returns_none_when_absent(self):
        assert get_escalation_config({"project_key": "TEST"}) is None


class TestOverthinkConfig:
    def test_overthink_config_with_custom_markers(self, monkeypatch):
        monkeypatch.setenv(
            "SLACK_INTEGRATION_BOT_CONFIG",
            """
C123:
  name: "#test-channel"
  ai_enabled: true
  qanda:
    enabled: true
    overthink:
      enabled: true
      skip_markers: ["NO_ACTION", "IRRELEVANT"]
      pass_marker: "ACTIONABLE"
      custom_prompt: "Custom overthink: {message_text}"
      followup_prompt: "Custom followup: {message_text}"
  ai_alerts:
    enabled: true
    overthink:
      enabled: true
      skip_markers: ["SKIP"]
      pass_marker: "PROCESS"
  default:
    project_key: TEST
""",
        )
        cfg = Config.from_env()
        qanda = cfg.channels["C123"].qanda
        assert qanda.overthink.enabled is True
        assert qanda.overthink.skip_markers == ["NO_ACTION", "IRRELEVANT"]
        assert qanda.overthink.pass_marker == "ACTIONABLE"
        assert qanda.overthink.custom_prompt == "Custom overthink: {message_text}"
        assert qanda.overthink.followup_prompt == "Custom followup: {message_text}"

        alerts = cfg.channels["C123"].ai_alerts
        assert alerts.overthink.enabled is True
        assert alerts.overthink.skip_markers == ["SKIP"]
        assert alerts.overthink.pass_marker == "PROCESS"

    def test_overthink_defaults_when_enabled_minimal(self, monkeypatch):
        monkeypatch.setenv(
            "SLACK_INTEGRATION_BOT_CONFIG",
            """
C123:
  name: "#test-channel"
  ai_enabled: true
  qanda:
    enabled: true
    overthink:
      enabled: true
  ai_alerts:
    enabled: false
  default:
    project_key: TEST
""",
        )
        cfg = Config.from_env()
        cfg.apply_defaults_to_channels()
        qanda = cfg.channels["C123"].qanda
        assert qanda.overthink.enabled is True
        assert qanda.overthink.skip_markers == ["DEFER", "LOW_CONFIDENCE"]
        assert qanda.overthink.pass_marker == "CONFIDENCE: HIGH"
        # apply_defaults sets the default overthink prompt
        assert qanda.custom_prompt == cfg.defaults.overthink_qanda_prompt
        # apply_defaults sets the default followup prompt
        assert qanda.overthink.followup_prompt == cfg.defaults.humble_followup_prompt
