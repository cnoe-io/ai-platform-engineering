"""Temperature configuration utility for LLM providers."""

import logging
import os

logger = logging.getLogger(__name__)


def get_temperature_for_provider() -> float:
    """Get temperature setting based on LLM provider.

    Returns temperature from provider-specific environment variable,
    with proper ordering to handle Azure before OpenAI.

    Returns:
        float: Temperature value between 0.0 and 2.0, defaulting to 0.3
    """
    provider = os.getenv("LLM_PROVIDER", "").lower()
    temperature = 0.3  # Default temperature for tool-calling agents

    # Provider to environment variable mapping (order matters for substring matching)
    provider_temp_vars = {
        "azure": "AZURE_TEMPERATURE",  # Check Azure before OpenAI
        "openai": "OPENAI_TEMPERATURE",
        "anthropic": "ANTHROPIC_TEMPERATURE",
        "bedrock": "BEDROCK_TEMPERATURE",
        "aws": "BEDROCK_TEMPERATURE",
        "google": "GOOGLE_TEMPERATURE",
        "gemini": "GOOGLE_TEMPERATURE",
        "vertex": "VERTEXAI_TEMPERATURE",
    }

    # Find matching provider and get temperature
    temp_str = "0.3"
    for provider_keyword, env_var in provider_temp_vars.items():
        if provider_keyword in provider:
            temp_str = os.getenv(env_var, "0.3")
            break

    # Safe parsing with validation
    # Strip comments if present (handle inline comments like "1  # comment")
    if "#" in temp_str:
        temp_str = temp_str.split("#")[0].strip()

    try:
        temperature = float(temp_str)
        # Validate temperature range (most providers support 0.0 to 2.0)
        if temperature < 0.0:
            logger.warning(f"Temperature {temperature} below 0.0, using 0.0")
            temperature = 0.0
        elif temperature > 2.0:
            logger.warning(f"Temperature {temperature} above 2.0, using 2.0")
            temperature = 2.0
    except (ValueError, TypeError):
        logger.warning(f"Invalid temperature value '{temp_str}', using default 0.3")
        temperature = 0.3

    logger.debug(f"Using temperature {temperature} for provider '{provider}'")
    return temperature


def is_bedrock_provider() -> bool:
    """Check if the current LLM provider is AWS Bedrock.

    Returns:
        bool: True if provider is Bedrock, False otherwise
    """
    provider = os.getenv("LLM_PROVIDER", "").lower()
    return "bedrock" in provider or "aws" in provider
