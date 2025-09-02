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

# Default agents
ARGOCD_ENABLED = os.getenv("ENABLE_ARGOCD", "true").lower() == "true"
logger.info("ArgoCD enabled: %s", ARGOCD_ENABLED)

BACKSTAGE_ENABLED = os.getenv("ENABLE_BACKSTAGE", "true").lower() == "true"
logger.info("Backstage enabled: %s", BACKSTAGE_ENABLED)

CONFLUENCE_ENABLED = os.getenv("ENABLE_CONFLUENCE", "true").lower() == "true"
logger.info("Confluence enabled: %s", CONFLUENCE_ENABLED)

GITHUB_ENABLED = os.getenv("ENABLE_GITHUB", "true").lower() == "true"
logger.info("GitHub enabled: %s", GITHUB_ENABLED)

JIRA_ENABLED = os.getenv("ENABLE_JIRA", "true").lower() == "true"
logger.info("Jira enabled: %s", JIRA_ENABLED)

PAGERDUTY_ENABLED = os.getenv("ENABLE_PAGERDUTY", "true").lower() == "true"
logger.info("PagerDuty enabled: %s", PAGERDUTY_ENABLED)

SLACK_ENABLED = os.getenv("ENABLE_SLACK", "true").lower() == "true"
logger.info("Slack enabled: %s", SLACK_ENABLED)


# Optional agents
KOMODOR_ENABLED = os.getenv("ENABLE_KOMODOR", "false").lower() == "true"
logger.info("Komodor enabled: %s", KOMODOR_ENABLED)

WEATHER_AGENT_ENABLED = os.getenv("ENABLE_WEATHER_AGENT", "false").lower() == "true"
logger.info("Weather agent enabled: %s", WEATHER_AGENT_ENABLED)

PETSTORE_AGENT_ENABLED = os.getenv("ENABLE_PETSTORE_AGENT", "false").lower() == "true"
logger.info("Petstore agent enabled: %s", PETSTORE_AGENT_ENABLED)

KB_RAG_ENABLED = os.getenv("ENABLE_KB_RAG", "false").lower() == "true"
logger.info("KB-RAG enabled: %s", KB_RAG_ENABLED)

GRAPH_RAG_ENABLED = os.getenv("ENABLE_GRAPH_RAG", "false").lower() == "true"
logger.info("Graph-RAG enabled: %s", GRAPH_RAG_ENABLED)


AGENT_NAMES = []

if ARGOCD_ENABLED:
    AGENT_NAMES.append("argocd")

if BACKSTAGE_ENABLED:
    AGENT_NAMES.append("backstage")

if CONFLUENCE_ENABLED:
    AGENT_NAMES.append("confluence")

if GITHUB_ENABLED:
    AGENT_NAMES.append("github")

if JIRA_ENABLED:
    AGENT_NAMES.append("jira")

if PAGERDUTY_ENABLED:
    AGENT_NAMES.append("pagerduty")

if SLACK_ENABLED:
    AGENT_NAMES.append("slack")

if KOMODOR_ENABLED:
    AGENT_NAMES.append("komodor")

if WEATHER_AGENT_ENABLED:
    AGENT_NAMES.append("weather")

if PETSTORE_AGENT_ENABLED:
    AGENT_NAMES.append("petstore")

if KB_RAG_ENABLED:
    AGENT_NAMES.append("kb-rag")

if GRAPH_RAG_ENABLED:
    AGENT_NAMES.append("graph-rag")

class PlatformRegistry(AgentRegistry):
    """Registry for platform engineer multi-agent system."""
    AGENT_NAMES = AGENT_NAMES

# Create the platform registry instance
platform_registry = PlatformRegistry()
