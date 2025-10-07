# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Multi-Agent System for AI Platform Engineering.

This module provides the main entry point for the multi-agent system,
including the AgentRegistry and related functionality.
"""

from .agent_registry import AgentRegistry

# Create a convenience function for backward compatibility
def get_enabled_agents(validate_imports: bool = True):
    """Convenience function to get enabled agents using AgentRegistry.get_enabled_agents()"""
    return AgentRegistry.get_enabled_agents(validate_imports=validate_imports)

# Re-export for backward compatibility
__all__ = [
    "AgentRegistry",
    "get_enabled_agents",
]