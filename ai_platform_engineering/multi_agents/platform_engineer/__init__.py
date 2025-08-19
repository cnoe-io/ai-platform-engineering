# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os
import logging

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any A2A imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

# Disable A2A framework tracing to prevent interference with custom tracing
disable_a2a_tracing()
logging.info("A2A tracing disabled for Platform Engineer")

# =====================================================
# Now safe to import AgentRegistry and create platform_registry
# =====================================================

from ai_platform_engineering.multi_agents import AgentRegistry


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

KOMODOR_ENABLED = os.getenv("ENABLE_KOMODOR", "false").lower() == "true"
logger.info("Komodor enabled: %s", KOMODOR_ENABLED)

WEATHER_AGENT_ENABLED = os.getenv("ENABLE_WEATHER_AGENT", "false").lower() == "true"
logger.info("Weather agent enabled: %s", WEATHER_AGENT_ENABLED)

KB_RAG_ENABLED = os.getenv("ENABLE_KB_RAG", "false").lower() == "true"
logger.info("KB-RAG enabled: %s", KB_RAG_ENABLED)

logger.info("Local Build Running......")

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

if KB_RAG_ENABLED:
    AGENT_NAMES.append("kb-rag")

class PlatformRegistry(AgentRegistry):
    """Registry for platform engineer multi-agent system."""

    AGENT_NAMES = AGENT_NAMES

# Create the platform registry instance
platform_registry = PlatformRegistry()
