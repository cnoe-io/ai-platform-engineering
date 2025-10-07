"""Define a custom Reasoning and Action agent.

Works with a chat model with tool calling support.
"""
import os

import httpx
from common.agent.tools import (
    fetch_entity_details,
    search,
    get_entity_properties,
    get_entity_types,
    get_relation_path_between_entity_types,
    raw_graph_query,
    check_if_ontology_generated
)
from datetime import datetime, timezone
from langchain_core.prompts import PromptTemplate
from langgraph.prebuilt import create_react_agent

from typing import AsyncIterable, Any

from langchain_core.messages import AIMessage
from langchain_core.messages.utils import (
    trim_messages
)
import dotenv

from common import utils
from common.graph_db.neo4j.graph_db import Neo4jDB

from langgraph.checkpoint.memory import MemorySaver
from cnoe_agent_utils import LLMFactory

from agent_rag.prompts import SYSTEM_PROMPT_COMBINED, SYSTEM_PROMPT_RAG_ONLY

# Load environment variables from .env file
dotenv.load_dotenv()

memory = MemorySaver()

logger = utils.get_logger(__name__)

graph_rag_enabled = os.getenv("ENABLE_GRAPH_RAG", "true").lower() in ("true", "1", "yes")
server_url = os.getenv("RAG_SERVER_URL", "http://localhost:9446")

if graph_rag_enabled:
    logger.info("Graph RAG is enabled.")
    DB_READ_TOOLS = [search, get_entity_types, get_entity_properties, fetch_entity_details, get_relation_path_between_entity_types, check_if_ontology_generated, raw_graph_query]
    ui_url = str(os.getenv("RAG_UI_URL", "http://localhost:9447/explore/entity"))
else:
    logger.info("Graph RAG is disabled.")
    DB_READ_TOOLS = [search]


def pre_model_hook(state):
    trimmed_messages = trim_messages(
        state["messages"],
        strategy="last",
        token_counter=len,
        include_system=True,
        max_tokens=20,
        start_on="human",
        end_on=("human", "tool"),
    )
    return {"llm_input_messages": trimmed_messages}

class QnAAgent:
    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']
    def __init__(self):
        if graph_rag_enabled:
            self.graphdb = Neo4jDB(readonly=True)

        self.llm = LLMFactory().get_llm()
        print(f"Using LLM: {self.llm}")
        logger.info(f"Number of tools: {len(DB_READ_TOOLS)}")
        self.graph = create_react_agent(
            model=self.llm,
            name="RAG_Q&A_Agent",
            tools=DB_READ_TOOLS,
            checkpointer=memory,
            prompt=self.render_system_prompt, # type: ignore
            pre_model_hook=pre_model_hook,
        )

    async def render_system_prompt(self, state, *args) -> str:
        """
        Render the system prompt (dynamically) with the current time and rag database information.
        """
        # Call the REST API endpoint
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

        async for item in self.graph.astream(inputs, config, stream_mode='values'): # type: ignore
            message = item['messages'][-1]
            # logger.debug(f"Streamed message: {message}")
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