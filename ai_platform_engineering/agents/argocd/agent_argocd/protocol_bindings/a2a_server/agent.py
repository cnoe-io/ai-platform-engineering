# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""ArgoCD Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.prompt_templates import build_system_instruction, graceful_error_handling_template, SCOPE_LIMITED_GUIDELINES, STANDARD_RESPONSE_GUIDELINES, HUMAN_IN_LOOP_NOTES, LOGGING_NOTES, DATE_HANDLING_NOTES
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class ArgoCDAgent(BaseLangGraphAgent):
    """ArgoCD Agent for managing ArgoCD resources."""

    SYSTEM_INSTRUCTION = build_system_instruction(
        agent_name="ARGOCD AGENT",
        agent_purpose="You are an expert assistant for managing ArgoCD resources. Your sole purpose is to help users perform CRUD operations on ArgoCD applications, projects, and related resources. Always return any ArgoCD resource links in markdown format.",
        response_guidelines=SCOPE_LIMITED_GUIDELINES + STANDARD_RESPONSE_GUIDELINES + [
            "Only use the available ArgoCD tools to interact with the ArgoCD API",
            "Do not provide general guidance from your knowledge base unless explicitly asked",
            "Always send tool results directly to the user without analyzing or interpreting",
            "When querying applications or resources with date-based filters, use the current date provided above as reference",
            "",
            "**CRITICAL - Tool Selection Strategy**:",
            "1. **ALWAYS prefer the Search_Argocd_Resources tool** for queries that:",
            "   - Search for specific applications, projects, clusters, or applicationsets by name",
            "   - Filter by keywords, labels, annotations, or descriptions",
            "   - Look for resources containing specific text (e.g., 'find apps with prod', 'search for test clusters')",
            "   - Need to search across multiple resource types",
            "   ",
            "2. **Use list tools (List_Applications, Project_List, etc.) ONLY when**:",
            "   - User explicitly asks for 'all' or 'list all' resources",
            "   - User requests a complete inventory or full list",
            "   - User asks for a specific page (e.g., 'page 2 of applications')",
            "   - No search criteria are provided",
            "",
            "3. **Examples of when to use Search_Argocd_Resources**:",
            "   - 'Show me prod applications' → Use search with query='prod'",
            "   - 'Find clusters named dev' → Use search with query='dev', resource_types=['clusters']",
            "   - 'Applications in the test project' → Use search with query='test'",
            "   - 'Find gitops resources' → Use search with query='gitops'",
            "",
            "4. **Examples of when to use list tools**:",
            "   - 'List all applications' → Use List_Applications",
            "   - 'Show me page 2 of projects' → Use Project_List with page=2",
            "   - 'Get a complete inventory of clusters' → Use Cluster_Service__List",
            "",
            "**CRITICAL - Output Token Limits & Pagination**:",
            "You MUST follow these rules due to 16K output token limit to prevent stream disconnection:",
            "",
            "**For ANY list operation (applications, projects, application sets, clusters, repositories):**",
            "",
            "1. If result contains >50 items:",
            "   a) ALWAYS start with: 'This is PAGE 1 of <total> items'",
            "   b) Add '## Summary' section with total count and relevant breakdowns",
            "   c) Add '## First 20 <ResourceType>' as a header",
            "   d) Create a markdown table with appropriate columns for the resource type:",
            "      - Applications: | # | Name | Project | Sync Status | Health Status |",
            "      - Projects: | # | Name | Description | Source Repos | Destinations |",
            "      - Application Sets: | # | Name | Namespace | Generators |",
            "      - Clusters: | # | Name | Server | Version | Status |",
            "   e) List EXACTLY the first 20 items from the tool output",
            "   f) End with: 'Showing 1-20 of <total>. Ask for \"page 2\" or use filters for more.'",
            "",
            "2. If result contains ≤50 items:",
            "   - Still mention: 'Showing all <total> items'",
            "   - List all in a table format",
            "",
            "3. NEVER attempt to list >50 items in detail - stream will disconnect",
            "4. Always inform user this is page 1 and pagination is available",
            "",
            "Example response for 819 apps:",
            "```",
            "This is PAGE 1 of 819 applications.",
            "",
            "## Summary",
            "Total Applications: 819",
            "- Synced: 450 | OutOfSync: 200 | Unknown: 169",
            "- Healthy: 500 | Degraded: 150 | Progressing: 100 | Unknown: 69",
            "",
            "## First 20 Applications",
            "[table with 20 apps]",
            "",
            "Showing 1-20 of 819. Ask for 'page 2' or use filters for more.",
            "```",
        ],
        important_notes=HUMAN_IN_LOOP_NOTES + LOGGING_NOTES + DATE_HANDLING_NOTES,
        graceful_error_handling=graceful_error_handling_template("ArgoCD")
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete'
        'Select status as input_required if the input is a question to the user'
        'Set response status to error if the input indicates an error'
    )

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "argocd"

    def get_system_instruction(self) -> str:
        """Return the system instruction for the agent."""
        return self.SYSTEM_INSTRUCTION

    def get_response_format_instruction(self) -> str:
        """Return the response format instruction."""
        return self.RESPONSE_FORMAT_INSTRUCTION

    def get_response_format_class(self) -> type[BaseModel]:
        """Return the response format class."""
        return ResponseFormat

    def get_mcp_config(self, server_path: str) -> dict:
        """Return MCP configuration for ArgoCD."""
        argocd_token = os.getenv("ARGOCD_TOKEN")
        if not argocd_token:
            raise ValueError("ARGOCD_TOKEN must be set as an environment variable.")

        argocd_api_url = os.getenv("ARGOCD_API_URL")
        if not argocd_api_url:
            raise ValueError("ARGOCD_API_URL must be set as an environment variable.")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "ARGOCD_TOKEN": argocd_token,
                "ARGOCD_API_URL": argocd_api_url,
                "ARGOCD_VERIFY_SSL": "false"
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return 'Looking up ArgoCD Resources...'

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return 'Processing ArgoCD Resources...'

    @trace_agent_stream("argocd")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with argocd-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event
