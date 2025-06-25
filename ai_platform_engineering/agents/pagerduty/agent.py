# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory

from ai_platform_engineering.agents.pagerduty.a2a_agentcards import (
    pagerduty_agent_card, pagerduty_agent_skill, )
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)
from ai_platform_engineering.mas.platform_engineer.prompts import get_agent_system_prompt, get_agent_skills_prompt

model = LLMFactory().get_llm()

# initialize the flavor profile tool with the farm agent card
pagerduty_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="pagerduty_tools_agent",
    description="Handles tasks related to PagerDuty incidents, alerts, and on-call schedules.",
    remote_agent_card=pagerduty_agent_card,
    skill_id=pagerduty_agent_skill.id,
)

pagerduty_system_prompt = get_agent_system_prompt("pagerduty")
pagerduty_skills_prompt = get_agent_skills_prompt("pagerduty")

pagerduty_agent = create_react_agent(
    model=model,
    tools=[pagerduty_a2a_remote_agent],
    name="pagerduty_agent",
    prompt=pagerduty_system_prompt,
)
