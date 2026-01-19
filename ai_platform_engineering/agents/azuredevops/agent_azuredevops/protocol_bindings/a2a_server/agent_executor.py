# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from agent_azuredevops.protocol_bindings.a2a_server.agent import AzureDevOpsAgent
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor


class AzureDevOpsAgentExecutor(BaseLangGraphAgentExecutor):
    """Azure DevOps AgentExecutor using base class."""

    def __init__(self):
        super().__init__(AzureDevOpsAgent())
