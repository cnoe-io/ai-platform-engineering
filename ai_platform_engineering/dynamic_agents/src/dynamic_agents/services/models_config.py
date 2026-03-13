"""Models configuration loader for Dynamic Agents.

Loads available LLM models from a YAML configuration file that can be
mounted as a ConfigMap in Kubernetes deployments.
"""

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

# Default path for config (can be overridden via SEED_CONFIG_PATH env var)
DEFAULT_CONFIG_PATH = Path(__file__).parent / "config.yaml"


@dataclass
class ModelInfo:
    """Information about an available LLM model."""

    model_id: str
    name: str
    provider: str
    description: str = ""


def get_config_path() -> Path:
    """Get the configuration file path from environment or default."""
    env_path = os.environ.get("SEED_CONFIG_PATH")
    if env_path:
        return Path(env_path)
    return DEFAULT_CONFIG_PATH


def load_models_config(config_path: Path | str | None = None) -> list[ModelInfo]:
    """Load available models from YAML configuration.

    Args:
        config_path: Path to the config YAML file.
                    Defaults to SEED_CONFIG_PATH env var or config.yaml in the same directory.

    Returns:
        List of ModelInfo objects representing available models.
    """
    if config_path is None:
        config_path = get_config_path()

    config_path = Path(config_path)

    if not config_path.exists():
        raise FileNotFoundError(f"Models config not found at {config_path}")

    with open(config_path) as f:
        config = yaml.safe_load(f)

    models = []
    for item in config.get("models", []):
        models.append(
            ModelInfo(
                model_id=item.get("model_id", ""),
                name=item.get("name", "Unknown"),
                provider=item.get("provider", "unknown"),
                description=item.get("description", ""),
            )
        )

    logger.info(f"Loaded {len(models)} models from {config_path}")
    return models


@lru_cache
def get_available_models() -> list[ModelInfo]:
    """Get cached list of available models.

    This function is cached to avoid repeated file reads.
    Restart the service to reload the models config.
    """
    return load_models_config()
