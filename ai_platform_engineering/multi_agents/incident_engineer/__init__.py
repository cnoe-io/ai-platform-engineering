# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os
import logging

from ai_platform_engineering.multi_agents import AgentRegistry


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

KOMODOR_ENABLED = os.getenv("ENABLE_KOMODOR", "false").lower() == "true"
logger.info("Komodor enabled: %s", KOMODOR_ENABLED)

AGENT_NAMES = [
    "github",
    "pagerduty",
    "jira",
    "backstage",
    "confluence",
]

if KOMODOR_ENABLED:
    AGENT_NAMES.append("komodor")

class IncidentRegistry(AgentRegistry):
    """Registry for incident engineer multi-agent system."""

    AGENT_NAMES = AGENT_NAMES

# Create the incident registry instance
incident_registry = IncidentRegistry()
