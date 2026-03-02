# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
CAIPE Slack Bot configuration loading and initialization.
"""

from loguru import logger
from .config_models import Config

# Load all configuration
try:
    config = Config.from_env()
    config.apply_defaults_to_channels()
    logger.info(f"Loaded configuration for {len(config.channels)} channel(s)")
except Exception as e:
    logger.error(f"Failed to load config: {e}")
    raise
