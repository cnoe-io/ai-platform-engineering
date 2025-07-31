import os

# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

KB_RAG_AGENT_HOST = os.getenv("KB_RAG_AGENT_HOST", "localhost")
KB_RAG_AGENT_PORT = os.getenv("KB_RAG_AGENT_PORT", "8000")

print("===================================")
print("         KB-RAG AGENT CONFIG      ")
print("===================================")
print(f"KB_RAG_AGENT_HOST: {KB_RAG_AGENT_HOST}")
print(f"KB_RAG_AGENT_PORT: {KB_RAG_AGENT_PORT}")
print("===================================")

kb_rag_agent_skill = AgentSkill(
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

kb_rag_agent_card = AgentCard(
  name='KB-RAG',
  id='kb-rag-agent',
  description='An AI agent that provides intelligent search and question answering capabilities using a knowledge base with RAG (Retrieval-Augmented Generation).',
  url=f'http://{KB_RAG_AGENT_HOST}:{KB_RAG_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[kb_rag_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)
