"""Define a custom Reasoning and Action agent.

Works with a chat model with tool calling support.
"""
import os

import httpx
# Updated imports to use standardized function names with graph_ prefix
# These function names in tools.py were standardized to clearly distinguish
# graph-related operations from document search operations.
from common.agent.tools import (
    graph_fetch_entity_details,      # Renamed from: fetch_entity_details
    search,                           # Unchanged - document search
    graph_get_entity_properties,     # Renamed from: get_entity_properties
    graph_get_entity_types,          # Renamed from: get_entity_types
    graph_get_relation_path_between_entity_types,  # Renamed from: get_relation_path_between_entity_types
    graph_raw_query,                 # Renamed from: raw_graph_query
    graph_check_if_ontology_generated  # Renamed from: check_if_ontology_generated
)
from datetime import datetime, timezone
from langchain_core.prompts import PromptTemplate
from langgraph.prebuilt import create_react_agent
from langmem.short_term import SummarizationNode
from langchain_core.messages.utils import count_tokens_approximately


from typing import AsyncIterable, Any

from langchain_core.messages import AIMessage
import dotenv

from common import utils
from common.graph_db.neo4j.graph_db import Neo4jDB
from langgraph.prebuilt.chat_agent_executor import AgentState


from langgraph.checkpoint.memory import MemorySaver
from cnoe_agent_utils import LLMFactory

from agent_rag.prompts import SYSTEM_PROMPT_COMBINED, SYSTEM_PROMPT_RAG_ONLY

# Load environment variables from .env file
dotenv.load_dotenv()

memory = MemorySaver()

logger = utils.get_logger(__name__)

graph_rag_enabled = os.getenv("ENABLE_GRAPH_RAG", "true").lower() in ("true", "1", "yes")
server_url = os.getenv("RAG_SERVER_URL", "http://localhost:9446")
max_llm_tokens = int(os.getenv("MAX_LLM_TOKENS", 100000)) # the capacity of the LLM - default is configured for gpt-4o
max_summary_tokens = int(max_llm_tokens * 0.1) # Use 10% of the LLM capacity for the summary

if graph_rag_enabled:
    logger.info("Graph RAG is enabled.")
    DB_READ_TOOLS = [search, graph_get_entity_types, graph_get_entity_properties, graph_fetch_entity_details, graph_get_relation_path_between_entity_types, graph_check_if_ontology_generated, graph_raw_query]
    ui_url = str(os.getenv("RAG_UI_URL", "http://localhost:9447/explore/entity"))
else:
    logger.info("Graph RAG is disabled.")
    DB_READ_TOOLS = [search]

class QnAAgent:
    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

    def get_agent_name(self) -> str:
        """Return the agent name for logging."""
        return "RAG Agent"

    def __init__(self):
        if graph_rag_enabled:
            self.graphdb = Neo4jDB(readonly=True)

        self.llm = LLMFactory().get_llm()
        print(f"Using LLM: {self.llm}")
        logger.info(f"Number of tools: {len(DB_READ_TOOLS)}")

        class State(AgentState):
            # NOTE: we're adding this key to keep track of previous summary information
            # to make sure we're not summarizing on every LLM call
            context: dict[str, Any]

        self.graph = create_react_agent(
            model=self.llm,
            name="RAG_Q&A_Agent",
            tools=DB_READ_TOOLS,
            checkpointer=memory,
            state_schema=State,
            prompt=self.render_system_prompt, # type: ignore
            pre_model_hook=SummarizationNode( # Add summarization
                token_counter=count_tokens_approximately,
                model=self.llm,
                max_tokens=max_llm_tokens,
                max_summary_tokens=max_summary_tokens,
                output_messages_key="llm_input_messages"
            )
        )

    async def render_system_prompt(self, state, *args) -> str:
        """
        Render the system prompt (dynamically) with the current time and rag database information.
        """
        # Call the datasource endpoint for filtering
        async with httpx.AsyncClient() as client:
            response = await client.get(server_url + "/v1/datasources",
                timeout=30.0
            )
            response.raise_for_status()
            document_sources = response.json().get("datasources", [])

        if graph_rag_enabled:
            entity_types = await self.graphdb.get_all_entity_types()
            system_prompt = PromptTemplate.from_template(SYSTEM_PROMPT_COMBINED).format(
                system_time=datetime.now(tz=timezone.utc).isoformat(),
                graphdb_type=self.graphdb.database_type,
                query_language=self.graphdb.query_language,
                entities=utils.json_encode(entity_types),
                document_sources=document_sources,
                ui_url=ui_url
            )
        else:
            system_prompt = PromptTemplate.from_template(SYSTEM_PROMPT_RAG_ONLY).format(
                document_sources=document_sources
            )

        logger.debug("\n\n=====PROMPT=====\n"+system_prompt+"\n=============\n\n")
        return [{"role": "system", "content": system_prompt}] + state["messages"]

    async def invoke(self, query, context_id) -> str:
        config = {'configurable': {'thread_id': context_id}}
        await self.graph.ainvoke({'messages': [('user', query)]}, config) # type: ignore
        return self.get_agent_response(config) # type: ignore

    async def stream(self, query, context_id, trace_id: (str | None)=None)  -> AsyncIterable[dict[str, Any]]:
        inputs = {'messages': [('user', query)]}
        config = {'configurable': {'thread_id': context_id}}

        # Track which tool calls we've already processed to avoid duplicates
        seen_tool_calls = set()

        # Use astream_events for token-by-token streaming
        # Direct queries: Tokens streamed immediately to user (ChatGPT-like experience)
        # Deep Agent: Tool collects all tokens via send_message_streaming, returns complete text
        async for event in self.graph.astream_events(inputs, config, version='v2'): # type: ignore
            event_type = event.get('event')

            # Handle tool call events (show search indicator once per tool)
            if event_type == 'on_chat_model_stream':
                chunk_data = event.get('data', {}).get('chunk')
                if chunk_data:
                    # Check for tool calls - only yield once per tool call
                    if hasattr(chunk_data, 'tool_call_chunks') and chunk_data.tool_call_chunks:
                        for tool_call_chunk in chunk_data.tool_call_chunks:
                            tool_call_id = getattr(tool_call_chunk, 'id', None)
                            if not tool_call_id or tool_call_id in seen_tool_calls:
                                continue

                            seen_tool_calls.add(tool_call_id)
                            content = f"🔍 Searching knowledge base..."
                            logger.info(f"Search initiated: {tool_call_id}")
                            yield {
                                'is_task_complete': False,
                                'require_user_input': False,
                                'content': content,
                            }

                    # Handle content tokens (stream each token immediately!)
                    elif hasattr(chunk_data, 'content') and chunk_data.content:
                        token = chunk_data.content
                        if isinstance(token, str) and token:
                            logger.debug(f"Token: '{token}' ({len(token)} chars)")

                            # Yield each token immediately
                            # Direct queries: User sees tokens in real-time
                            # Deep Agent: Tool accumulates via send_message_streaming
                            yield {
                                'is_task_complete': False,
                                'require_user_input': False,
                                'content': token,
                            }

        # Send final completion marker
        yield {
            'is_task_complete': True,
            'require_user_input': False,
            'content': '',  # Empty - content already streamed above
        }

    def get_agent_response(self, config):
        """
        Gets the response from the agent based on the current state of the graph.
        This function checks the last AIMessage in the state and returns its content.

        In the original A2A example, it would get a strucutured response from the agent.
        Here, we assume the agent's response is a string or a list of strings, saves tokens, and is faster.
        If the last AIMessage does not contain a valid response, it returns a default message.
        """
        current_state = self.graph.get_state(config)
        messages = current_state.values.get("messages", [])
        for message in reversed(messages):
            if isinstance(message, AIMessage):
                content = message.content
                logger.debug(f"Agent response content: {message}")
                if isinstance(content, str):
                    return {
                        'is_task_complete': True,
                        'require_user_input': False,
                        'content': content,
                    }
                elif isinstance(content, list) and len(content) > 0:
                    return {
                        'is_task_complete': True,
                        'require_user_input': False,
                        'content': content[0],
                    }

        return {
            'is_task_complete': False,
            'require_user_input': True,
            'content': (
                'We are unable to process your request at the moment. '
                'Please try again.'
            ),
        }

# For langgraph studio
# agent = QnAAgent()
# graph = agent.graph