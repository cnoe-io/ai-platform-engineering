# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os

from ai_platform_engineering.agents.kubernetes.agent_kubernetes.agentcard import (
    create_agent_card,
    agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)

AGENT_HOST = os.getenv("KUBERNETES_AGENT_HOST", "localhost")
AGENT_PORT = os.getenv("KUBERNETES_AGENT_PORT", "8000")
agent_url = f'http://{AGENT_HOST}:{AGENT_PORT}'

agent_card = create_agent_card(agent_url)
tool_map = {
    agent_card.name: agent_skill.examples
}

# initialize the flavor profile tool with the farm agent card
a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="kubernetes_tools_agent",
    description=agent_card.description,
    remote_agent_card=agent_card,
    skill_id=agent_skill.id,
)
