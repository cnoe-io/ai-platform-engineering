# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for context_config module."""

import os
import unittest

from ai_platform_engineering.utils.a2a_common.context_config import (
    DEFAULT_PROVIDER_CONTEXT_LIMITS,
    PROVIDER_ENV_VARS,
    get_context_config,
    get_context_limit_for_provider,
    get_min_messages_to_keep,
    is_auto_compression_enabled,
    log_context_config,
)


class TestContextConfig(unittest.TestCase):
    """Test context configuration functions."""

    def setUp(self):
        """Save and clear relevant environment variables."""
        self.env_backup = {}
        env_vars = [
            "LLM_PROVIDER",
            "MAX_CONTEXT_TOKENS",
            "MIN_MESSAGES_TO_KEEP",
            "ENABLE_AUTO_COMPRESSION",
            "AZURE_OPENAI_MAX_CONTEXT_TOKENS",
            "OPENAI_MAX_CONTEXT_TOKENS",
            "AWS_BEDROCK_MAX_CONTEXT_TOKENS",
            "ANTHROPIC_MAX_CONTEXT_TOKENS",
            "GOOGLE_GEMINI_MAX_CONTEXT_TOKENS",
            "GCP_VERTEXAI_MAX_CONTEXT_TOKENS",
        ]
        for var in env_vars:
            self.env_backup[var] = os.environ.pop(var, None)

    def tearDown(self):
        """Restore environment variables."""
        for var, value in self.env_backup.items():
            if value is not None:
                os.environ[var] = value
            else:
                os.environ.pop(var, None)


class TestGetContextLimitForProvider(TestContextConfig):
    """Test get_context_limit_for_provider function."""

    def test_default_azure_openai(self):
        """Test default limit for azure-openai."""
        limit = get_context_limit_for_provider("azure-openai")
        self.assertEqual(limit, 100000)

    def test_default_aws_bedrock(self):
        """Test default limit for aws-bedrock."""
        limit = get_context_limit_for_provider("aws-bedrock")
        self.assertEqual(limit, 150000)

    def test_default_google_gemini(self):
        """Test default limit for google-gemini."""
        limit = get_context_limit_for_provider("google-gemini")
        self.assertEqual(limit, 800000)

    def test_default_anthropic_claude(self):
        """Test default limit for anthropic-claude."""
        limit = get_context_limit_for_provider("anthropic-claude")
        self.assertEqual(limit, 150000)

    def test_default_gcp_vertexai(self):
        """Test default limit for gcp-vertexai."""
        limit = get_context_limit_for_provider("gcp-vertexai")
        self.assertEqual(limit, 150000)

    def test_default_openai(self):
        """Test default limit for openai."""
        limit = get_context_limit_for_provider("openai")
        self.assertEqual(limit, 100000)

    def test_unknown_provider_fallback(self):
        """Test unknown provider falls back to 100000."""
        limit = get_context_limit_for_provider("unknown-provider")
        self.assertEqual(limit, 100000)

    def test_provider_from_env_when_none(self):
        """Test provider is read from LLM_PROVIDER env when not specified."""
        os.environ["LLM_PROVIDER"] = "aws-bedrock"
        limit = get_context_limit_for_provider(None)
        self.assertEqual(limit, 150000)

    def test_provider_from_env_default_azure(self):
        """Test default provider is azure-openai when LLM_PROVIDER not set."""
        limit = get_context_limit_for_provider(None)
        self.assertEqual(limit, 100000)

    def test_provider_case_insensitive(self):
        """Test provider name is case-insensitive."""
        limit1 = get_context_limit_for_provider("AZURE-OPENAI")
        limit2 = get_context_limit_for_provider("Azure-OpenAI")
        limit3 = get_context_limit_for_provider("azure-openai")
        self.assertEqual(limit1, limit2)
        self.assertEqual(limit2, limit3)

    def test_provider_specific_env_override(self):
        """Test provider-specific environment variable override."""
        os.environ["AWS_BEDROCK_MAX_CONTEXT_TOKENS"] = "180000"
        limit = get_context_limit_for_provider("aws-bedrock")
        self.assertEqual(limit, 180000)

    def test_multiple_provider_specific_overrides(self):
        """Test multiple provider-specific overrides don't interfere."""
        os.environ["AZURE_OPENAI_MAX_CONTEXT_TOKENS"] = "120000"
        os.environ["AWS_BEDROCK_MAX_CONTEXT_TOKENS"] = "180000"

        azure_limit = get_context_limit_for_provider("azure-openai")
        bedrock_limit = get_context_limit_for_provider("aws-bedrock")

        self.assertEqual(azure_limit, 120000)
        self.assertEqual(bedrock_limit, 180000)

    def test_global_override(self):
        """Test global MAX_CONTEXT_TOKENS override."""
        os.environ["MAX_CONTEXT_TOKENS"] = "120000"
        limit = get_context_limit_for_provider("azure-openai")
        self.assertEqual(limit, 120000)

    def test_provider_specific_takes_precedence_over_global(self):
        """Test provider-specific override takes precedence over global."""
        os.environ["MAX_CONTEXT_TOKENS"] = "120000"
        os.environ["AWS_BEDROCK_MAX_CONTEXT_TOKENS"] = "180000"

        limit = get_context_limit_for_provider("aws-bedrock")
        self.assertEqual(limit, 180000)

    def test_invalid_provider_specific_falls_back_to_global(self):
        """Test invalid provider-specific value falls back to global."""
        os.environ["AWS_BEDROCK_MAX_CONTEXT_TOKENS"] = "not-a-number"
        os.environ["MAX_CONTEXT_TOKENS"] = "120000"

        limit = get_context_limit_for_provider("aws-bedrock")
        self.assertEqual(limit, 120000)

    def test_invalid_global_falls_back_to_default(self):
        """Test invalid global value falls back to default."""
        os.environ["MAX_CONTEXT_TOKENS"] = "invalid"

        limit = get_context_limit_for_provider("azure-openai")
        self.assertEqual(limit, 100000)

    def test_invalid_provider_specific_and_global_use_default(self):
        """Test both invalid values use default."""
        os.environ["AZURE_OPENAI_MAX_CONTEXT_TOKENS"] = "invalid1"
        os.environ["MAX_CONTEXT_TOKENS"] = "invalid2"

        limit = get_context_limit_for_provider("azure-openai")
        self.assertEqual(limit, 100000)

    def test_all_providers_have_env_vars(self):
        """Test all default providers have corresponding env vars."""
        for provider in DEFAULT_PROVIDER_CONTEXT_LIMITS.keys():
            self.assertIn(provider, PROVIDER_ENV_VARS)


class TestGetMinMessagesToKeep(TestContextConfig):
    """Test get_min_messages_to_keep function."""

    def test_default_value(self):
        """Test default min messages is 10."""
        min_msgs = get_min_messages_to_keep()
        self.assertEqual(min_msgs, 10)

    def test_custom_value_from_env(self):
        """Test custom value from environment."""
        os.environ["MIN_MESSAGES_TO_KEEP"] = "20"
        min_msgs = get_min_messages_to_keep()
        self.assertEqual(min_msgs, 20)

    def test_invalid_value_uses_default(self):
        """Test invalid value falls back to default."""
        os.environ["MIN_MESSAGES_TO_KEEP"] = "not-a-number"
        min_msgs = get_min_messages_to_keep()
        self.assertEqual(min_msgs, 10)

    def test_zero_value(self):
        """Test zero value is accepted."""
        os.environ["MIN_MESSAGES_TO_KEEP"] = "0"
        min_msgs = get_min_messages_to_keep()
        self.assertEqual(min_msgs, 0)

    def test_large_value(self):
        """Test large value is accepted."""
        os.environ["MIN_MESSAGES_TO_KEEP"] = "1000"
        min_msgs = get_min_messages_to_keep()
        self.assertEqual(min_msgs, 1000)


class TestIsAutoCompressionEnabled(TestContextConfig):
    """Test is_auto_compression_enabled function."""

    def test_default_enabled(self):
        """Test auto-compression is enabled by default."""
        enabled = is_auto_compression_enabled()
        self.assertTrue(enabled)

    def test_explicitly_enabled(self):
        """Test explicitly enabled with 'true'."""
        os.environ["ENABLE_AUTO_COMPRESSION"] = "true"
        enabled = is_auto_compression_enabled()
        self.assertTrue(enabled)

    def test_disabled_with_false(self):
        """Test disabled with 'false'."""
        os.environ["ENABLE_AUTO_COMPRESSION"] = "false"
        enabled = is_auto_compression_enabled()
        self.assertFalse(enabled)

    def test_case_insensitive_true(self):
        """Test 'TRUE', 'True', etc. all work."""
        for value in ["TRUE", "True", "TrUe", "true"]:
            with self.subTest(value=value):
                os.environ["ENABLE_AUTO_COMPRESSION"] = value
                enabled = is_auto_compression_enabled()
                self.assertTrue(enabled)

    def test_case_insensitive_false(self):
        """Test 'FALSE', 'False', etc. all work."""
        for value in ["FALSE", "False", "FaLsE", "false"]:
            with self.subTest(value=value):
                os.environ["ENABLE_AUTO_COMPRESSION"] = value
                enabled = is_auto_compression_enabled()
                self.assertFalse(enabled)

    def test_invalid_value_disabled(self):
        """Test invalid values are treated as disabled."""
        for value in ["yes", "1", "on", "enabled", "invalid"]:
            with self.subTest(value=value):
                os.environ["ENABLE_AUTO_COMPRESSION"] = value
                enabled = is_auto_compression_enabled()
                self.assertFalse(enabled)


class TestGetContextConfig(TestContextConfig):
    """Test get_context_config function."""

    def test_default_config(self):
        """Test default configuration."""
        config = get_context_config()

        self.assertEqual(config["provider"], "azure-openai")
        self.assertEqual(config["max_context_tokens"], 100000)
        self.assertEqual(config["min_messages_to_keep"], 10)
        self.assertTrue(config["auto_compression_enabled"])

    def test_custom_provider(self):
        """Test with custom provider."""
        os.environ["LLM_PROVIDER"] = "aws-bedrock"
        config = get_context_config()

        self.assertEqual(config["provider"], "aws-bedrock")
        self.assertEqual(config["max_context_tokens"], 150000)

    def test_all_custom_values(self):
        """Test with all custom values."""
        os.environ["LLM_PROVIDER"] = "google-gemini"
        os.environ["GOOGLE_GEMINI_MAX_CONTEXT_TOKENS"] = "900000"
        os.environ["MIN_MESSAGES_TO_KEEP"] = "15"
        os.environ["ENABLE_AUTO_COMPRESSION"] = "false"

        config = get_context_config()

        self.assertEqual(config["provider"], "google-gemini")
        self.assertEqual(config["max_context_tokens"], 900000)
        self.assertEqual(config["min_messages_to_keep"], 15)
        self.assertFalse(config["auto_compression_enabled"])

    def test_config_keys(self):
        """Test configuration has all expected keys."""
        config = get_context_config()

        expected_keys = {
            "provider",
            "max_context_tokens",
            "min_messages_to_keep",
            "auto_compression_enabled"
        }
        self.assertEqual(set(config.keys()), expected_keys)

    def test_provider_case_normalization(self):
        """Test provider is normalized to lowercase."""
        os.environ["LLM_PROVIDER"] = "AWS-BEDROCK"
        config = get_context_config()

        self.assertEqual(config["provider"], "aws-bedrock")


class TestLogContextConfig(TestContextConfig):
    """Test log_context_config function."""

    def test_logs_default_config(self):
        """Test logging default configuration."""
        with self.assertLogs(level='INFO') as log_context:
            log_context_config()

        # Verify log message contains expected information
        log_output = ''.join(log_context.output)
        self.assertIn('provider=azure-openai', log_output)
        self.assertIn('max_tokens=100,000', log_output)
        self.assertIn('min_messages=10', log_output)
        self.assertIn('auto_compression=True', log_output)

    def test_logs_custom_config(self):
        """Test logging custom configuration."""
        os.environ["LLM_PROVIDER"] = "aws-bedrock"
        os.environ["AWS_BEDROCK_MAX_CONTEXT_TOKENS"] = "180000"

        with self.assertLogs(level='INFO') as log_context:
            log_context_config()

        log_output = ''.join(log_context.output)
        self.assertIn('provider=aws-bedrock', log_output)
        self.assertIn('max_tokens=180,000', log_output)


if __name__ == '__main__':
    unittest.main()

