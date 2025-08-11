# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os
import logging

from ai_platform_engineering.multi_agents import AgentRegistry


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

KOMODOR_ENABLED = os.getenv("ENABLE_KOMODOR", "false").lower() == "true"
logger.info("Komodor enabled: %s", KOMODOR_ENABLED)

WEATHER_AGENT_ENABLED = os.getenv("ENABLE_WEATHER_AGENT", "false").lower() == "true"
logger.info("Weather agent enabled: %s", WEATHER_AGENT_ENABLED)

AGENT_NAMES = [
    "argocd",
    "backstage",
    "confluence",
    "github",
    "jira",
    "pagerduty",
    "slack"
]

if KOMODOR_ENABLED:
    AGENT_NAMES.append("komodor")

if WEATHER_AGENT_ENABLED:
    AGENT_NAMES.append("weather")

class PlatformRegistry(AgentRegistry):
    """Registry for platform engineer multi-agent system."""

    AGENT_NAMES = AGENT_NAMES

# Create the platform registry instance
platform_registry = PlatformRegistry()
