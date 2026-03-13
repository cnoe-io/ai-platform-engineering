"""Models configuration for Dynamic Agents.

Provides access to available LLM models loaded from the seed configuration
at startup. Models are cached in memory and returned via get_available_models().
"""

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ModelInfo:
    """Information about an available LLM model."""

    model_id: str
    name: str
    provider: str
    description: str = ""


# Module-level cache for models loaded at startup
_cached_models: list[ModelInfo] = []


def set_available_models(models: list[ModelInfo]) -> None:
    """Set the cached models list (called at startup).

    Args:
        models: List of ModelInfo objects to cache
    """
    global _cached_models
    _cached_models = models
    logger.info(f"Cached {len(models)} models for API access")


def get_available_models() -> list[ModelInfo]:
    """Get the list of available models.

    Returns:
        List of ModelInfo objects loaded at startup.
    """
    return _cached_models
