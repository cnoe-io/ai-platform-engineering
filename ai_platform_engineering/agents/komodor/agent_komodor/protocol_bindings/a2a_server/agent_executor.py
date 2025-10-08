# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Komodor AgentExecutor implementation using common base class."""

from ai_platform_engineering.utils.a2a import BaseAgentExecutor
from agent_komodor.protocol_bindings.a2a_server.agent import KomodorAgent


class KomodorAgentExecutor(BaseAgentExecutor):
    """Komodor AgentExecutor implementation."""

    def __init__(self):
        """Initialize with Komodor agent."""
        super().__init__(KomodorAgent())
