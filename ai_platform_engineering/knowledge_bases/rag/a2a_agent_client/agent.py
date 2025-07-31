# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from cnoe_agent_utils import LLMFactory

from ai_platform_engineering.agents.kb_rag.a2a_agent_client.agentcard import (
    kb_rag_agent_card, kb_rag_agent_skill, )
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)
from ai_platform_engineering.multi_agents.platform_engineer.prompts import get_agent_system_prompt


model = LLMFactory().get_llm()

# initialize the knowledge base RAG tool with the kb-rag agent card
kb_rag_a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="kb_rag_tools_agent",
    description="Handles tasks related to knowledge base retrieval, document search, and RAG operations.",
    remote_agent_card=kb_rag_agent_card,
    skill_id=kb_rag_agent_skill.id,
)

kb_rag_system_prompt = get_agent_system_prompt("kb_rag")

kb_rag_agent = create_react_agent(
    model=model,
    tools=[kb_rag_a2a_remote_agent],
    name="kb_rag_agent",
    prompt=kb_rag_system_prompt,
)
