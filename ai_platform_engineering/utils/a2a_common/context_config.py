# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Global context management configuration for all agent types.

In single-node mode every agent runs in the same process and shares one set of
environment variables.  To let each agent keep its own context-management
settings, all public helpers accept an optional ``agent_name`` parameter.

Priority chain (highest wins):
  1. Agent-scoped env var   – ``<AGENT>_MAX_CONTEXT_TOKENS``
  2. Provider-specific env  – ``AWS_BEDROCK_MAX_CONTEXT_TOKENS``
  3. Global override env    – ``MAX_CONTEXT_TOKENS``
  4. Hardcoded default

The same pattern applies to ``MIN_MESSAGES_TO_KEEP``,
``ENABLE_AUTO_COMPRESSION``, and ``MAX_TOOL_OUTPUT_LENGTH``.
"""

import logging
import os
from typing import Dict, Optional

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


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _agent_env(agent_name: Optional[str], var_name: str) -> Optional[str]:
    """Return the value of ``<AGENT>_<VAR_NAME>`` if *agent_name* is given.

    For example ``_agent_env("argocd", "MAX_CONTEXT_TOKENS")`` looks up
    ``ARGOCD_MAX_CONTEXT_TOKENS``.  Returns ``None`` when *agent_name* is
    ``None`` or the env var is unset.
    """
    if not agent_name:
        return None
    key = f"{agent_name.upper()}_{var_name}"
    return os.getenv(key)


def get_max_tool_output_length(agent_name: Optional[str] = None, default: int = 2000) -> int:
    """Return the maximum tool-output length for streaming truncation.

    Priority: ``<AGENT>_MAX_TOOL_OUTPUT_LENGTH`` > ``MAX_TOOL_OUTPUT_LENGTH``
    > *default*.
    """
    agent_val = _agent_env(agent_name, "MAX_TOOL_OUTPUT_LENGTH")
    if agent_val:
        try:
            return int(agent_val)
        except ValueError:
            pass
    try:
        return int(os.getenv("MAX_TOOL_OUTPUT_LENGTH", str(default)))
    except ValueError:
        return default


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_context_limit_for_provider(
    provider: str = None,
    *,
    agent_name: Optional[str] = None,
) -> int:
    """
    Get the context token limit for a specific LLM provider.

    Priority order:
    1. Agent-scoped env var (e.g., ARGOCD_MAX_CONTEXT_TOKENS)
    2. Provider-specific environment variable (e.g., AWS_BEDROCK_MAX_CONTEXT_TOKENS)
    3. Global override environment variable (MAX_CONTEXT_TOKENS)
    4. Default limit for the provider
    5. Fallback default (100000)

    Args:
        provider: LLM provider name (e.g., "aws-bedrock", "azure-openai")
                 If None, uses LLM_PROVIDER environment variable
        agent_name: Optional agent name for scoped lookups (e.g., "argocd").
                    When set, ``<AGENT>_MAX_CONTEXT_TOKENS`` is checked first.

    Returns:
        Context token limit as integer

    Examples:
        >>> get_context_limit_for_provider("azure-openai")
        100000

        >>> os.environ["ARGOCD_MAX_CONTEXT_TOKENS"] = "20000"
        >>> get_context_limit_for_provider("aws-bedrock", agent_name="argocd")
        20000
    """
    # Get provider from environment if not specified
    if provider is None:
        provider = os.getenv("LLM_PROVIDER", "azure-openai")

    provider = provider.lower()

    # 1. Check agent-scoped environment variable
    agent_val = _agent_env(agent_name, "MAX_CONTEXT_TOKENS")
    if agent_val:
        try:
            limit = int(agent_val)
            logger.info(
                f"Using agent-scoped context limit from "
                f"{agent_name.upper()}_MAX_CONTEXT_TOKENS: {limit:,} tokens"
            )
            return limit
        except ValueError:
            logger.warning(
                f"Invalid value for {agent_name.upper()}_MAX_CONTEXT_TOKENS="
                f"'{agent_val}', falling back to next priority"
            )

    # 2. Check provider-specific environment variable
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

    # 3. Check global override environment variable
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

    # 4. Use default limit for the provider
    default_limit = DEFAULT_PROVIDER_CONTEXT_LIMITS.get(provider, 100000)
    logger.debug(
        f"Using default context limit for provider={provider}: {default_limit:,} tokens"
    )
    return default_limit


def get_min_messages_to_keep(agent_name: Optional[str] = None) -> int:
    """
    Get the minimum number of recent messages to always keep.

    Priority: ``<AGENT>_MIN_MESSAGES_TO_KEEP`` > ``MIN_MESSAGES_TO_KEEP`` > 10.

    Args:
        agent_name: Optional agent name for scoped lookups.

    Returns:
        Minimum messages to keep (default: 10)
    """
    agent_val = _agent_env(agent_name, "MIN_MESSAGES_TO_KEEP")
    if agent_val:
        try:
            return int(agent_val)
        except ValueError:
            logger.warning(
                f"Invalid value for {agent_name.upper()}_MIN_MESSAGES_TO_KEEP="
                f"'{agent_val}', falling back"
            )
    try:
        return int(os.getenv("MIN_MESSAGES_TO_KEEP", "10"))
    except ValueError:
        logger.warning(
            f"Invalid value for MIN_MESSAGES_TO_KEEP='{os.getenv('MIN_MESSAGES_TO_KEEP')}', "
            "using default: 10"
        )
        return 10


def is_auto_compression_enabled(agent_name: Optional[str] = None) -> bool:
    """
    Check if auto-compression is enabled.

    Priority: ``<AGENT>_ENABLE_AUTO_COMPRESSION`` > ``ENABLE_AUTO_COMPRESSION``
    > ``true``.

    Args:
        agent_name: Optional agent name for scoped lookups.

    Returns:
        True if enabled (default), False otherwise
    """
    agent_val = _agent_env(agent_name, "ENABLE_AUTO_COMPRESSION")
    if agent_val is not None:
        return agent_val.lower() == "true"
    return os.getenv("ENABLE_AUTO_COMPRESSION", "true").lower() == "true"


def get_context_config(agent_name: Optional[str] = None) -> Dict[str, any]:
    """
    Get complete context management configuration.

    Args:
        agent_name: Optional agent name for scoped lookups.

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
        "max_context_tokens": get_context_limit_for_provider(
            provider, agent_name=agent_name
        ),
        "min_messages_to_keep": get_min_messages_to_keep(agent_name=agent_name),
        "auto_compression_enabled": is_auto_compression_enabled(
            agent_name=agent_name
        ),
    }


def log_context_config(agent_name: Optional[str] = None):
    """Log the current context management configuration."""
    config = get_context_config(agent_name=agent_name)
    prefix = f"[{agent_name}] " if agent_name else ""
    logger.info(
        f"{prefix}Context management config: provider={config['provider']}, "
        f"max_tokens={config['max_context_tokens']:,}, "
        f"min_messages={config['min_messages_to_keep']}, "
        f"auto_compression={config['auto_compression_enabled']}"
    )







