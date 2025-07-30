# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory
import os

from ai_platform_engineering.agents.jira.agentcard import (
	JIRA_AGENT_DESCRIPTION,
    jira_agent_card,
)
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import (
    AgntcySlimRemoteAgentConnectTool,
)

model = LLMFactory().get_llm()

SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

# initialize the flavor profile tool with the farm agent card
jira_a2a_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="jira_tools_agent",
    description=JIRA_AGENT_DESCRIPTION,
    endpoint=SLIM_ENDPOINT,
    remote_agent_card=jira_agent_card,
)
