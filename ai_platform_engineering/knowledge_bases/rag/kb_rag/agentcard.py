# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from dotenv import load_dotenv

from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

load_dotenv()

# ==================================================
# AGENT SPECIFIC CONFIGURATION
# Modify these values for your specific agent
# ==================================================
AGENT_NAME = 'kb-rag'
AGENT_DESCRIPTION = 'An AI agent that provides intelligent search and question answering using a knowledge base with RAG (Retrieval-Augmented Generation).'

agent_skill = AgentSkill(
  id="kb_rag_agent_skill",
  name="Knowledge Base RAG Agent Skill",
  description="Handles tasks related to knowledge base retrieval, question answering, and document search using RAG (Retrieval-Augmented Generation).",
  tags=[
    "knowledge base",
    "rag",
    "retrieval",
    "question answering",
    "document search"],
  examples=[
      "Search the knowledge base for information about API authentication.",
      "Answer questions about system architecture using the knowledge base.",
      "Retrieve relevant documents for troubleshooting network issues.",
      "Find documentation about deployment procedures.",
      "Get information about best practices for code reviews."
  ])

# ==================================================
# SHARED CONFIGURATION - DO NOT MODIFY
# This section is reusable across all agents
# ==================================================
SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

capabilities = AgentCapabilities(streaming=False, pushNotifications=False)

def create_agent_card(agent_url):
  print("===================================")
  print(f"       {AGENT_NAME.upper()} AGENT CONFIG      ")
  print("===================================")
  print(f"AGENT_URL: {agent_url}")
  print("===================================")

  return AgentCard(
    name=AGENT_NAME,
    id=f'{AGENT_NAME.lower()}-tools-agent',
    description=AGENT_DESCRIPTION,
    url=agent_url,
    version='0.1.0',
    defaultInputModes=SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[agent_skill],
    # Using the security field instead of the non-existent AgentAuthentication class
    security=[{"public": []}],
  ) 