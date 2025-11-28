"""Define a custom Reasoning and Action agent.

Works with a chat model with tool calling support.
"""
import os
import time

import httpx
from langgraph.prebuilt import create_react_agent
from langmem.short_term import SummarizationNode
from langchain_core.messages.utils import count_tokens_approximately
from mcp import ClientSession
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools

from typing import AsyncIterable, Any

from langchain_core.messages import AIMessage
import dotenv

from common import utils
from langgraph.prebuilt.chat_agent_executor import AgentState


from langgraph.checkpoint.memory import MemorySaver
from cnoe_agent_utils import LLMFactory

from agent_rag.prompts import get_rag_no_graph_prompt, get_rag_prompt

# Load environment variables from .env file
dotenv.load_dotenv()

memory = MemorySaver()

logger = utils.get_logger(__name__)

server_url = str(os.getenv("RAG_SERVER_URL", "http://localhost:9446")).strip("/")
max_llm_tokens = int(os.getenv("MAX_LLM_TOKENS", 100000)) # the capacity of the LLM - default is configured for gpt-4o
max_summary_tokens = int(max_llm_tokens * 0.1) # Use 10% of the LLM capacity for the summary

# Config cache TTL in seconds (5 minutes)
server_config_ttl = int(os.getenv("SERVER_CONFIG_CACHE_TTL_SECONDS", 60)) # Default to 1 minute

class QnAAgent:
    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

    def get_agent_name(self) -> str:
        """Return the agent name for logging."""
        return "RAG Agent"

    def __init__(self):

        self.llm = LLMFactory().get_llm()
        self.server_config = None
        self.graph_rag_enabled = False
        self.server_config_timestamp = None
        self.client = MultiServerMCPClient({
                "rag": {
                    "url": f"{server_url}/mcp",
                    "transport": "streamable_http",
                }
            })
        print(f"Using LLM: {self.llm}")
        
    
    async def update_server_config(self):
        """Get server config with 5-minute caching."""
        current_time = time.time()
        
        # Check if config is None or stale (older than TTL)
        if (self.server_config is None or 
            self.server_config_timestamp is None or 
            current_time - self.server_config_timestamp > server_config_ttl):
            
            logger.info("Server config is stale or missing, reloading...")
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.get(server_url + "/healthz", timeout=5.0)
                    if response.status_code == 200:
                        self.server_config = response.json()
                        self.server_config_timestamp = current_time
                        self.graph_rag_enabled = self.server_config.get("graph_rag_enabled", False)
                        self.server_config = self.server_config.get("config", {})
                        logger.info(f"Server config reloaded successfully: {self.server_config}")
                    else:
                        logger.warning(f"Failed to reload server config: HTTP {response.status_code}")
                        # Keep using cached config if available, otherwise return minimal config
                        if self.server_config is None:
                            self.server_config = {"graph_rag_enabled": False, "datasources": []}
            except Exception as e:
                logger.error(f"Error reloading server config: {e}")
                # Keep using cached config if available, otherwise return minimal config
                if self.server_config is None:
                    self.server_config = {"graph_rag_enabled": False, "datasources": []}
        else:
            logger.debug("Using cached server config")

    async def setup(self):

        class State(AgentState):
            # NOTE: we're adding this key to keep track of previous summary information
            # to make sure we're not summarizing on every LLM call
            context: dict[str, Any]

        # Load initial server config
        await self.update_server_config()

        # Get tools
        tools = await self.client.get_tools()

        logger.info(f"Number of tools: {len(tools)}")

        self.graph = create_react_agent(
            model=self.llm,
            name="RAG_Q&A_Agent",
            tools=tools,
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
        # Get server config (with caching)
        await self.update_server_config()
        logger.debug(f"Server config for prompt rendering: {self.server_config}")
        
        # Check if RAG is available
        if not self.server_config:
            return "RAG is not available at the moment. You cannot answer questions that require knowledge base access."

        graph_rag_enabled = self.server_config.get("graph_rag_enabled", False)
        ui_url = self.server_config.get("ui_url", "")
        document_sources = self.server_config.get("datasources", [])
        entities = self.server_config.get("graph_db", {"graph_entity_types": []})["graph_entity_types"]
        graph_db_type = self.server_config.get("graph_db", {"data_graph": {"type": "unknown"}})["data_graph"]["type"]
        graph_db_query_language = self.server_config.get("graph_db", {"data_graph": {"query_language": "unknown"}})["data_graph"]["query_language"]

        if graph_rag_enabled:
            system_prompt = get_rag_prompt(
                document_sources=utils.json_encode(document_sources),
                entities=utils.json_encode(entities),
                graphdb_type=graph_db_type,
                query_language=graph_db_query_language,
                ui_url=ui_url
            )
        else:
            system_prompt = get_rag_no_graph_prompt(
                document_sources=utils.json_encode(document_sources),
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
                            content = "🔍 Searching knowledge base..."
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