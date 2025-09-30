# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os
import logging

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any A2A imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

# =====================================================
# Module initialization - must happen before AgentRegistry import
# =====================================================

# Disable A2A framework tracing to prevent interference with custom tracing
disable_a2a_tracing()
logging.info("A2A tracing disabled for Platform Engineer")

# =====================================================
# Now safe to import AgentRegistry and create platform_registry
# =====================================================

# Import after tracing is properly configured
from ai_platform_engineering.multi_agents import AgentRegistry  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

AGENT_NAMES = []

# Default agents
if os.getenv("ENABLE_ARGOCD", "true").lower() == "true":
    AGENT_NAMES.append("argocd")

if os.getenv("ENABLE_AWS", "true").lower() == "true":
    AGENT_NAMES.append("aws")

if os.getenv("ENABLE_BACKSTAGE", "true").lower() == "true":
    AGENT_NAMES.append("backstage")

if os.getenv("ENABLE_CONFLUENCE", "true").lower() == "true":
    AGENT_NAMES.append("confluence")

if os.getenv("ENABLE_GITHUB", "true").lower() == "true":
    AGENT_NAMES.append("github")

logger.info("Local Build Running......")

if os.getenv("ENABLE_JIRA", "true").lower() == "true":
    AGENT_NAMES.append("jira")

if os.getenv("ENABLE_PAGERDUTY", "true").lower() == "true":
    AGENT_NAMES.append("pagerduty")

if os.getenv("ENABLE_SLACK", "true").lower() == "true":
    AGENT_NAMES.append("slack")

if os.getenv("ENABLE_SPLUNK", "true").lower() == "true":
    AGENT_NAMES.append("splunk")

if os.getenv("ENABLE_WEBEX_AGENT", "true").lower() == "true":
    AGENT_NAMES.append("webex")

# Optional agents
if os.getenv("ENABLE_KOMODOR", "false").lower() == "true":
    AGENT_NAMES.append("komodor")

if os.getenv("ENABLE_WEATHER_AGENT", "false").lower() == "true":
    AGENT_NAMES.append("weather")

if os.getenv("ENABLE_PETSTORE_AGENT", "false").lower() == "true":
    AGENT_NAMES.append("petstore")

if os.getenv("ENABLE_KB_RAG", "false").lower() == "true":
    AGENT_NAMES.append("kb-rag")

if os.getenv("ENABLE_GRAPH_RAG", "false").lower() == "true":
    AGENT_NAMES.append("graph-rag")

if os.getenv("ENABLE_LITELLM", "false").lower() == "true":
    AGENT_NAMES.append("litellm")

for agent_name in AGENT_NAMES:
    logger.info("🤖 Agent enabled: %s", agent_name)

class PlatformRegistry(AgentRegistry):
    """Registry for platform engineer multi-agent system."""
    AGENT_NAMES = AGENT_NAMES

# Create the platform registry instance
platform_registry = PlatformRegistry()
