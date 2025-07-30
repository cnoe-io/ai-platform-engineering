# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory
import os

from ai_platform_engineering.agents.pagerduty.agentcard import (
    pagerduty_agent_card,
	PAGERDUTY_AGENT_DESCRIPTION,
)
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import (
    AgntcySlimRemoteAgentConnectTool,
)
from ai_platform_engineering.multi_agents.platform_engineer.prompts import get_agent_system_prompt

model = LLMFactory().get_llm()

SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

# initialize the flavor profile tool with the farm agent card
pagerduty_a2a_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="pagerduty_tools_agent",
    description=PAGERDUTY_AGENT_DESCRIPTION,
    endpoint=SLIM_ENDPOINT,
    remote_agent_card=pagerduty_agent_card,
)

pagerduty_system_prompt = get_agent_system_prompt("pagerduty")
