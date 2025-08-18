# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os
import logging
from typing import Dict, Any
import importlib

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class AgentRegistry:
    """Centralized registry for transport-aware agent management."""

    # Default agent names - to be overridden by subclasses
    AGENT_NAMES = []

    # Map agent names to their import paths
    AGENT_IMPORT_MAP = {
        "github": {
            "slim": "ai_platform_engineering.agents.github.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.github.clients.a2a.agent"
        },
        "pagerduty": {
            "slim": "ai_platform_engineering.agents.pagerduty.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.pagerduty.clients.a2a.agent"
        },
        "jira": {
            "slim": "ai_platform_engineering.agents.jira.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.jira.clients.a2a.agent"
        },
        "backstage": {
            "slim": "ai_platform_engineering.agents.backstage.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.backstage.clients.a2a.agent"
        },
        "confluence": {
            "slim": "ai_platform_engineering.agents.confluence.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.confluence.clients.a2a.agent"
        },
        "argocd": {
            "slim": "ai_platform_engineering.agents.argocd.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.argocd.clients.a2a.agent"
        },
        "slack": {
            "slim": "ai_platform_engineering.agents.slack.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.slack.clients.a2a.agent"
        },
        "komodor": {
            "slim": "ai_platform_engineering.agents.komodor.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.komodor.clients.a2a.agent"
        },
        "weather": {
            "slim": "ai_platform_engineering.agents.weather.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.weather.clients.a2a.agent"
        },
        "kb-rag": {
            "slim": "ai_platform_engineering.knowledge_bases.rag.clients.slim.agent",
            "a2a": "ai_platform_engineering.knowledge_bases.rag.clients.a2a.agent"
        }
    }

    def __init__(self):
        self._transport = os.getenv("A2A_TRANSPORT", "p2p").lower()

        self._agents: Dict[str, Any] = {}  # Will be populated by _load_agents
        self._tools: Dict[str, Any] = {}  # Will be populated by _load_agents

        self._load_agents()

        logger.info("Running on A2A transport mode: %s", self._transport)
        logger.info("Loaded agents: %s", list(self._agents.keys()))

    @property
    def agents(self) -> Dict[str, Any]:
        """Get all available agents."""
        return self._agents

    @property
    def transport(self) -> str:
        """Get the current transport mode."""
        return self._transport

    def get_agent(self, name: str) -> Any:
        """Get a specific agent by name."""
        if name not in self.agents:
            raise ValueError(f"Agent '{name}' not found. Available: {list(self.agents.keys())}")
        return self.agents[name]

    def agent_exists(self, name: str) -> bool:
        return name in self.agents

    def get_all_agents(self):
        return list(self.agents.values())

    def get_tools(self):
        return self._tools

    def _load_agents(self) -> None:
        """Load the appropriate agent implementations based on transport mode."""
        agents = {}
        tools = {}

        # Load requested agents
        for agent_name in self.AGENT_NAMES:
            if agent_name not in self.AGENT_IMPORT_MAP:
                logger.warning(f"Unknown agent: {agent_name}")
                continue

            transport_key = "slim" if self.transport == "slim" else "a2a"
            module_path = self.AGENT_IMPORT_MAP[agent_name][transport_key]
            module = importlib.import_module(module_path)

            agents[agent_name] = module.a2a_remote_agent
            tools.update(module.tool_map)

        self._agents = agents
        self._tools = tools
