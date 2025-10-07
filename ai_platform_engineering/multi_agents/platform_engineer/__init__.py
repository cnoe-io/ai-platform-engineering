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

# Get enabled agents using the class method
AGENT_NAMES = AgentRegistry.get_enabled_agents()

for agent_name in AGENT_NAMES:
    logger.info("🤖 Agent enabled: %s", agent_name)

class PlatformRegistry(AgentRegistry):
    """Registry for platform engineer multi-agent system."""
    AGENT_NAMES = AGENT_NAMES

# Create the platform registry instance
platform_registry = PlatformRegistry()
