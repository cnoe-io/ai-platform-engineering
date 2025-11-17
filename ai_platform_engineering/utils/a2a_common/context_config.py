# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Global context management configuration for all agent types."""

import logging
import os
from typing import Dict

logger = logging.getLogger(__name__)

# Default context limits per provider (conservative with 20-30% safety margin)
# These values leave room for tool definitions and response generation
DEFAULT_PROVIDER_CONTEXT_LIMITS: Dict[str, int] = {
    "azure-openai": 100000,     # GPT-4o: 128K tokens, use 100K for safety (22% margin)
    "openai": 100000,           # GPT-4: 128K-200K depending on model, use 100K
    "aws-bedrock": 150000,      # Claude Sonnet 4.5: 200K tokens, use 150K (25% margin)
    "anthropic-claude": 150000, # Claude 3/4: 200K tokens, use 150K (25% margin)
    "google-gemini": 800000,    # Gemini 2.0: 1M-2M tokens, use 800K (20% margin)
    "gcp-vertexai": 150000,     # Varies by model, conservative default
}

# Environment variable mappings for provider-specific overrides
PROVIDER_ENV_VARS: Dict[str, str] = {
    "azure-openai": "AZURE_OPENAI_MAX_CONTEXT_TOKENS",
    "openai": "OPENAI_MAX_CONTEXT_TOKENS",
    "aws-bedrock": "AWS_BEDROCK_MAX_CONTEXT_TOKENS",
    "anthropic-claude": "ANTHROPIC_MAX_CONTEXT_TOKENS",
    "google-gemini": "GOOGLE_GEMINI_MAX_CONTEXT_TOKENS",
    "gcp-vertexai": "GCP_VERTEXAI_MAX_CONTEXT_TOKENS",
}


def get_context_limit_for_provider(provider: str = None) -> int:
    """
    Get the context token limit for a specific LLM provider.

    Priority order:
    1. Provider-specific environment variable (e.g., AWS_BEDROCK_MAX_CONTEXT_TOKENS)
    2. Global override environment variable (MAX_CONTEXT_TOKENS)
    3. Default limit for the provider
    4. Fallback default (100000)

    Args:
        provider: LLM provider name (e.g., "aws-bedrock", "azure-openai")
                 If None, uses LLM_PROVIDER environment variable

    Returns:
        Context token limit as integer

    Examples:
        >>> # Using default for azure-openai
        >>> get_context_limit_for_provider("azure-openai")
        100000

        >>> # With provider-specific override
        >>> os.environ["AWS_BEDROCK_MAX_CONTEXT_TOKENS"] = "180000"
        >>> get_context_limit_for_provider("aws-bedrock")
        180000

        >>> # With global override
        >>> os.environ["MAX_CONTEXT_TOKENS"] = "120000"
        >>> get_context_limit_for_provider("azure-openai")
        120000
    """
    # Get provider from environment if not specified
    if provider is None:
        provider = os.getenv("LLM_PROVIDER", "azure-openai")

    provider = provider.lower()

    # 1. Check provider-specific environment variable
    provider_env_var = PROVIDER_ENV_VARS.get(provider)
    if provider_env_var:
        provider_specific_limit = os.getenv(provider_env_var)
        if provider_specific_limit:
            try:
                limit = int(provider_specific_limit)
                logger.info(
                    f"Using provider-specific context limit from {provider_env_var}: "
                    f"{limit:,} tokens"
                )
                return limit
            except ValueError:
                logger.warning(
                    f"Invalid value for {provider_env_var}='{provider_specific_limit}', "
                    "falling back to next priority"
                )

    # 2. Check global override environment variable
    global_override = os.getenv("MAX_CONTEXT_TOKENS")
    if global_override:
        try:
            limit = int(global_override)
            logger.info(
                f"Using global context limit override from MAX_CONTEXT_TOKENS: "
                f"{limit:,} tokens"
            )
            return limit
        except ValueError:
            logger.warning(
                f"Invalid value for MAX_CONTEXT_TOKENS='{global_override}', "
                "falling back to default"
            )

    # 3. Use default limit for the provider
    default_limit = DEFAULT_PROVIDER_CONTEXT_LIMITS.get(provider, 100000)
    logger.debug(
        f"Using default context limit for provider={provider}: {default_limit:,} tokens"
    )
    return default_limit


def get_min_messages_to_keep() -> int:
    """
    Get the minimum number of recent messages to always keep.

    Returns:
        Minimum messages to keep (default: 10)
    """
    try:
        return int(os.getenv("MIN_MESSAGES_TO_KEEP", "10"))
    except ValueError:
        logger.warning(
            f"Invalid value for MIN_MESSAGES_TO_KEEP='{os.getenv('MIN_MESSAGES_TO_KEEP')}', "
            "using default: 10"
        )
        return 10


def is_auto_compression_enabled() -> bool:
    """
    Check if auto-compression is enabled.

    Returns:
        True if enabled (default), False otherwise
    """
    return os.getenv("ENABLE_AUTO_COMPRESSION", "true").lower() == "true"


def get_context_config() -> Dict[str, any]:
    """
    Get complete context management configuration.

    Returns:
        Dictionary with:
        - provider: LLM provider name
        - max_context_tokens: Token limit for the provider
        - min_messages_to_keep: Minimum messages to preserve
        - auto_compression_enabled: Whether auto-compression is enabled
    """
    provider = os.getenv("LLM_PROVIDER", "azure-openai").lower()
    return {
        "provider": provider,
        "max_context_tokens": get_context_limit_for_provider(provider),
        "min_messages_to_keep": get_min_messages_to_keep(),
        "auto_compression_enabled": is_auto_compression_enabled(),
    }


def log_context_config():
    """Log the current context management configuration."""
    config = get_context_config()
    logger.info(
        f"Context management config: provider={config['provider']}, "
        f"max_tokens={config['max_context_tokens']:,}, "
        f"min_messages={config['min_messages_to_keep']}, "
        f"auto_compression={config['auto_compression_enabled']}"
    )







