# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os

from ai_platform_engineering.knowledge_bases.rag.kb_rag.agentcard import (
    create_agent_card,
    agent_skill,
)
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)

KB_RAG_AGENT_HOST = os.getenv("KB_RAG_AGENT_HOST", "localhost")
KB_RAG_AGENT_PORT = os.getenv("KB_RAG_AGENT_PORT", "8000")
agent_url = f'http://{KB_RAG_AGENT_HOST}:{KB_RAG_AGENT_PORT}'

agent_card = create_agent_card(agent_url)

tool_map = {
    agent_card.name: agent_skill.examples
}

# initialize the A2A remote agent with the KB-RAG agent card
a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="kb_rag_tools_agent",
    description=agent_card.description,
    remote_agent_card=agent_card,
    skill_id=agent_skill.id,
)