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

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# =====================================================
# Agent Registry — skip in single-node mode
# =====================================================
# In single-node mode agents run as local MCP tools; no remote A2A agents exist.
# Set ENABLE_AGENT_REGISTRY=false to skip connectivity checks and use a null registry.

_REGISTRY_ENABLED = os.getenv("ENABLE_AGENT_REGISTRY", "true").lower() != "false"


class _NullAgentRegistry:
  """Stub registry used in single-node mode (no remote A2A agents)."""

  AGENT_NAMES = []

  @property
  def agents(self):
    return {}

  def agent_exists(self, name: str) -> bool:
    return False

  def get_agent_examples(self, name: str):
    return []

  def get_all_agents(self):
    return []

  def generate_subagents(self, agent_prompts, model):
    return []

  def enable_dynamic_monitoring(self, on_change_callback=None):
    pass

  def force_refresh(self) -> bool:
    return False

  def get_registry_status(self):
    return {"agents_count": 0, "tools_count": 0, "agents": [], "dynamic_monitoring": False}

  def print_connectivity_table(self):
    pass


if _REGISTRY_ENABLED:
  from ai_platform_engineering.multi_agents.agent_registry import AgentRegistry  # noqa: E402
  platform_registry = AgentRegistry()
  for agent_name in platform_registry.AGENT_NAMES:
    logger.info("🤖 Agent enabled: %s", agent_name)
else:
  logger.info("Agent registry disabled (ENABLE_AGENT_REGISTRY=false) — using null registry for single-node mode")
  platform_registry = _NullAgentRegistry()
