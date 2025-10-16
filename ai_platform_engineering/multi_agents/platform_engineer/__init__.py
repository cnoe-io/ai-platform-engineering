# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

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
from ai_platform_engineering.multi_agents.agent_registry import AgentRegistry  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Create the platform registry instance - it will automatically get enabled agents from env
platform_registry = AgentRegistry()

# Log enabled agents
for agent_name in platform_registry.AGENT_NAMES:
    logger.info("🤖 Agent enabled: %s", agent_name)
