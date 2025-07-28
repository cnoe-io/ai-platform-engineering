# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory

from ai_platform_engineering.agents.template.agent_petstore.a2a_agent_client.agentcard import (
    TEMPLATE_AGENT_DESCRIPTION,
    template_agent_card,
    template_agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)
# For demonstration, use a generic system prompt function or string
def get_agent_system_prompt(agent_name):
    return f"You are the {agent_name} agent. Respond helpfully to user queries."

model = LLMFactory().get_llm()

# initialize the remote agent tool with the template agent card
template_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="template_tools_agent",
    description=TEMPLATE_AGENT_DESCRIPTION,
    remote_agent_card=template_agent_card,
    skill_id=template_agent_skill.id,
)

template_system_prompt = get_agent_system_prompt("template")

template_agent = create_react_agent(
    model=model,
    tools=[template_a2a_remote_agent],
    name="template_agent",
    prompt=template_system_prompt,
) 