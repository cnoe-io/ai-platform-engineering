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

        async for item in self.graph.astream(inputs, config, stream_mode='values'): # type: ignore
            message = item['messages'][-1]
            logger.info(f"Processing message of type: {type(message)}")
            if isinstance(message, AIMessage):
                if message.tool_calls and len(message.tool_calls) > 0:
                    # Extract thoughts from tool calls to show user what the AI is thinking
                    thoughts = []
                    for tool_call in message.tool_calls:
                        logger.debug(f"Processing tool call: {tool_call}")
                        # Extract the thought parameter if it exists in the tool call args
                        # Handle both dict and object formats
                        args = None
                        if hasattr(tool_call, 'args') and isinstance(tool_call.args, dict):
                            args = tool_call.args
                        elif isinstance(tool_call, dict) and 'args' in tool_call:
                            args = tool_call['args']
                        if args and isinstance(args, dict):
                            thought = args.get('thought') # All rag tools have 'thought' param
                            if thought:
                                thoughts.append(thought)
                        else:
                            logger.debug(f"No args found in tool_call: {tool_call}")


                    # Use the extracted thoughts or fall back to a generic message
                    if thoughts:
                        content = "\n".join(thoughts) + "...\n"
                    else:
                        content = "Checking knowledge base...\n"
                    logger.info(f"Thought from tool call: {content}")
                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'content': content,
                    }
        response = self.get_agent_response(config)
        logger.debug(f"Final agent response: {response}")
        yield response

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