# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import uuid
from collections.abc import AsyncIterable
from typing import Any, Literal, Dict, List, Optional

from langchain_mcp_adapters.client import MultiServerMCPClient

from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from langchain_core.runnables.config import (
    RunnableConfig,
)
from pydantic import BaseModel

from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent, InjectedStore  # type: ignore
from langgraph.store.memory import InMemoryStore
from typing_extensions import Annotated

from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream
from langchain_openai import AzureOpenAIEmbeddings
import os

from agent_argocd.state import (
    AgentState,
    InputState,
    Message,
    MsgType,
)

logger = logging.getLogger(__name__)

def debug_print(message: str, banner: bool = True):
    if os.getenv("A2A_SERVER_DEBUG", "false").lower() == "true":
        if banner:
            print("=" * 80)
        print(f"DEBUG: {message}")
        if banner:
            print("=" * 80)

memory = MemorySaver()

class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str

def get_relevant_tools_for_query(query: str, tools: List[Any], store: Optional[InMemoryStore] = None) -> List[Any]:
    """
    BigTool integration: Custom tool retrieval function that uses semantic search
    to find the most relevant ArgoCD tools for the given query.
    """
    if not store:
        # If no semantic store available, return all tools
        debug_print(f"BigTool: No semantic store available, returning all {len(tools)} tools")
        return tools
    
    debug_print(f"BigTool searching for ArgoCD tools: '{query}'")
    
    try:
        # Use semantic search to find relevant tools (limit to 10 for efficiency)
        results = store.search(("argocd_tools",), query=query, limit=3)
        
        if not results:
            debug_print("BigTool: No semantic results found, returning all tools")
            return tools
        
        # Create a mapping of tool names to tools
        tool_map = {tool.name: tool for tool in tools}
        
        
        # Get the relevant tools based on search results
        relevant_tools = []
        for result in results:
            tool_name = result.value.get("name")
            if tool_name and tool_name in tool_map:
                relevant_tools.append(tool_map[tool_name])
        
        # If we couldn't find any tools from the search, return all tools
        if not relevant_tools:
            debug_print("BigTool: No matching tools found from search, returning all tools")
            return tools
        
        debug_print(f"BigTool found {len(relevant_tools)} relevant tools: {[t.name for t in relevant_tools]}")
        return relevant_tools
        
    except Exception as e:
        debug_print(f"BigTool error during search: {e}, returning all tools")
        return tools

class ArgoCDAgent:
    """ArgoCD Agent with BigTool integration."""

    SYSTEM_INSTRUCTION = (
      'You are an expert assistant for managing ArgoCD resources. '
      'Your sole purpose is to help users perform CRUD (Create, Read, Update, Delete) operations on ArgoCD applications, '
      'projects, and related resources. Only use the available ArgoCD tools to interact with the ArgoCD API and provide responses. '
      'Do not provide general guidance or information about ArgoCD from your knowledge base unless the user explicitly asks for it. '
      'If the user asks about anything unrelated to ArgoCD or its resources, politely state that you can only assist with ArgoCD operations. '
      'Do not attempt to answer unrelated questions or use tools for other purposes. '
      'Always return any ArgoCD resource links in markdown format (e.g., [App Link](https://example.com/app)).\n'
      '\n'
      '---\n'
      'Logs:\n'
      'When a user asks a question about logs, do not attempt to parse, summarize, or interpret the log content unless the user explicitly asks you to understand, analyze, or summarize the logs. '
      'By default, simply return the raw logs to the user, preserving all newlines and formatting as they appear in the original log output.\n'
      '\n'
      '---\n'
      'Human-in-the-loop:\n'
      'Before creating, updating, or deleting any ArgoCD application, you must ask the user for final confirmation. '
      'Clearly summarize the intended action (create, update, or delete), including the application name and relevant details, '
      'and prompt the user to confirm before proceeding. Only perform the action after receiving explicit user confirmation.\n'
      '\n'
      '---\n'
      'Always send the result from the ArgoCD tool response directly to the user, without analyzing, summarizing, or interpreting it. '
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete'
        'Select status as input_required if the input is a question to the user'
        'Set response status to error if the input indicates an error'
    )


    def __init__(self) -> None:
      # Setup the agent and load MCP tools with BigTool integration
      self.model = LLMFactory().get_llm()
      self.graph: Optional[Any] = None
      self.tracing = TracingManager()
      self._initialized: bool = False
      self.bigtool_store: Optional[InMemoryStore] = None
      self.all_tools: Optional[List[Any]] = None
      self.base_graph: Optional[Any] = None

      async def _async_argocd_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
          args = config.get("configurable", {})

          server_path = args.get("server_path", "./mcp/mcp_argocd/server.py")
          print(f"Launching MCP server at: {server_path}")

          argocd_token = os.getenv("ARGOCD_TOKEN")
          if not argocd_token:
            raise ValueError("ARGOCD_TOKEN must be set as an environment variable.")

          argocd_api_url = os.getenv("ARGOCD_API_URL")
          if not argocd_api_url:
            raise ValueError("ARGOCD_API_URL must be set as an environment variable.")

          client = None
          mcp_mode = os.getenv("MCP_MODE", "stdio").lower()
          if mcp_mode == "http" or mcp_mode == "streamable_http":
            logging.info("Using HTTP transport for MCP client")
            # For HTTP transport, we need to connect to the MCP server
            # This is useful for production or when the MCP server is running separately
            # Ensure MCP_HOST and MCP_PORT are set in the environment
            mcp_host = os.getenv("MCP_HOST", "localhost")
            mcp_port = os.getenv("MCP_PORT", "3000")
            logging.info(f"Connecting to MCP server at {mcp_host}:{mcp_port}")
            # TBD: Handle user authentication
            user_jwt = "TBD_USER_JWT"

            client = MultiServerMCPClient(
              {
                "argocd": {
                  "transport": "streamable_http",
                  "url": f"http://{mcp_host}:{mcp_port}/mcp/",
                  "headers": {
                    "Authorization": f"Bearer {user_jwt}",
                  },
                }
              }
            )
          else:
            logging.info("Using STDIO transport for MCP client")
            # For STDIO transport, we can use a simple client without URL
            # This is useful for local development or testing
            # Ensure ARGOCD_TOKEN and ARGOCD_API_URL are set in the environment
            client = MultiServerMCPClient(
                {
                  "argocd": {
                    "command": "uv",
                    "args": ["run", server_path],
                    "env": {
                        "ARGOCD_TOKEN": os.getenv("ARGOCD_TOKEN"),
                        "ARGOCD_API_URL": os.getenv("ARGOCD_API_URL"),
                        "ARGOCD_VERIFY_SSL": "false"
                    },
                    "transport": "stdio",
                  }
                }
            )

          tools = await client.get_tools()
          
          # BigTool Integration: Initialize semantic store for tool retrieval
          try:
              # Initialize Azure OpenAI embeddings
              embeddings = AzureOpenAIEmbeddings(model=os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-large"))
              
              self.bigtool_store = InMemoryStore(
                  index={
                      "embed": embeddings,
                      "dims": 1536,
                      "fields": ["description"],
                  }
              )
              debug_print("BigTool: Using Azure OpenAI semantic embeddings for tool retrieval")
          except Exception as e:
              # Fallback to basic in-memory store without embeddings
              self.bigtool_store = InMemoryStore()
              debug_print(f"BigTool: Using basic store (no embeddings): {e}")
          
          # Index all ArgoCD tools for BigTool semantic search
          for i, tool in enumerate(tools):
              self.bigtool_store.put(
                  ("argocd_tools",),
                  str(i),  # Use simple index as key
                  {
                      "description": f"{tool.name}: {tool.description}",
                      "name": tool.name,
                  },
              )
          
          debug_print(f"BigTool: Indexed {len(tools)} ArgoCD tools for semantic retrieval")
          
          # Store tools for later use
          self.all_tools = tools
          
          # For now, create the standard agent and implement BigTool as a query preprocessor
          # This is a simpler approach that works with the current architecture
          self.graph = create_react_agent(
            self.model,
            tools,  # Use all tools - BigTool will be applied at query time
            checkpointer=memory,
            prompt=self.SYSTEM_INSTRUCTION,
            response_format=(self.RESPONSE_FORMAT_INSTRUCTION, ResponseFormat),
          )
          
          debug_print("BigTool: ArgoCD agent initialized with dynamic tool selection capability")


          # Provide a 'configurable' key such as 'thread_id' for the checkpointer
          runnable_config = RunnableConfig(configurable={"thread_id": "one-time-test-thread"})
          llm_result = await self.graph.ainvoke({"messages": HumanMessage(content="Summarize what you can do?")}, config=runnable_config)

          # Try to extract meaningful content from the LLM result
          ai_content = None

          # Look through messages for final assistant content
          for msg in reversed(llm_result.get("messages", [])):
              if hasattr(msg, "type") and msg.type in ("ai", "assistant") and getattr(msg, "content", None):
                  ai_content = msg.content
                  break
              elif isinstance(msg, dict) and msg.get("type") in ("ai", "assistant") and msg.get("content"):
                  ai_content = msg["content"]
                  break

          # Fallback: if no content was found but tool_call_results exists
          if not ai_content and "tool_call_results" in llm_result:
              ai_content = "\n".join(
                  str(r.get("content", r)) for r in llm_result["tool_call_results"]
              )


          # Return response
          if ai_content:
              print("Assistant generated response")
              output_messages = [Message(type=MsgType.assistant, content=ai_content)]
          else:
              logger.warning("No assistant content found in LLM result")
              output_messages = []

          # Add a banner before printing the output messages
          debug_print(f"Agent MCP Capabilities: {output_messages[-1].content}")

      # Store the async function for later use
      self._async_argocd_agent = _async_argocd_agent

    def _create_specialized_agent(self, relevant_tools: List[Any]) -> Any:
      """Create a specialized agent with a subset of relevant tools."""
      return create_react_agent(
          self.model,
          relevant_tools,
          checkpointer=memory,
          prompt=self.SYSTEM_INSTRUCTION,
          response_format=(self.RESPONSE_FORMAT_INSTRUCTION, ResponseFormat),
      )

    async def _initialize_agent(self) -> None:
      """Initialize the agent asynchronously when first needed."""
      if self._initialized:
          return

      messages = []
      state_input = InputState(messages=messages)
      agent_input = AgentState(input=state_input).model_dump(mode="json")
      runnable_config = RunnableConfig()
      # Add a HumanMessage to the input messages if not already present
      if not any(isinstance(m, HumanMessage) for m in messages):
          messages.append(HumanMessage(content="What can you do?"))

      await self._async_argocd_agent(agent_input, config=runnable_config)
      self._initialized = True

    @trace_agent_stream("argocd")
    async def stream(
      self, query: str, context_id: str, trace_id: str = None
    ) -> AsyncIterable[dict[str, Any]]:
      logger.debug("DEBUG: Starting stream with query:", query, "and context_id:", context_id)

      # Initialize the agent if not already done
      await self._initialize_agent()

      inputs: dict[str, Any] = {'messages': [('user', query)]}
      config: RunnableConfig = self.tracing.create_config(context_id)

      # Use BigTool to potentially create a specialized agent for this query
      agent_to_use = self.graph
      if self.bigtool_store and self.all_tools:
          # Get relevant tools for this query
          relevant_tools = get_relevant_tools_for_query(query, self.all_tools, self.bigtool_store)
          
          # If we found a smaller set of relevant tools, create a specialized agent
          if len(relevant_tools) < len(self.all_tools):
              debug_print(f"BigTool: Creating specialized agent with {len(relevant_tools)} tools for streaming")
              agent_to_use = self._create_specialized_agent(relevant_tools)
              yield {
                'is_task_complete': False,
                'require_user_input': False,
                'content': f'BigTool: Selected {len(relevant_tools)} most relevant ArgoCD tools for your query...',
              }
      
      # Stream from the selected agent (either specialized or full)
      async for item in agent_to_use.astream(inputs, config, stream_mode='values'):
          message = item['messages'][-1]
          debug_print(f"Streamed message: {message}")
          if (
              isinstance(message, AIMessage)
              and message.tool_calls
              and len(message.tool_calls) > 0
          ):
              yield {
                'is_task_complete': False,
                'require_user_input': False,
                'content': 'Executing ArgoCD operations...',
              }
          elif isinstance(message, ToolMessage):
              yield {
                'is_task_complete': False,
                'require_user_input': False,
                'content': 'Processing ArgoCD Resources...',
              }

      yield self.get_agent_response(config)
      
    def get_agent_response(self, config: RunnableConfig) -> dict[str, Any]:
      debug_print(f"Fetching agent response with config: {config}")
      
      # Use the main graph for getting state (BigTool filtering is applied during execution)
      current_state = self.graph.get_state(config)
      debug_print(f"Current state: {current_state}")

      structured_response = current_state.values.get('structured_response')
      debug_print(f"Structured response: {structured_response}")
      if structured_response and isinstance(
        structured_response, ResponseFormat
      ):
        debug_print("Structured response is a valid ResponseFormat")
        if structured_response.status in {'input_required', 'error'}:
          debug_print("Status is input_required or error")
          return {
            'is_task_complete': False,
            'require_user_input': True,
            'content': structured_response.message,
          }
        if structured_response.status == 'completed':
          print("DEBUG: Status is completed")
          return {
            'is_task_complete': True,
            'require_user_input': False,
            'content': structured_response.message,
          }

      print("DEBUG: Unable to process request, returning fallback response")
      return {
        'is_task_complete': False,
        'require_user_input': True,
        'content': 'We are unable to process your request at the moment. Please try again.',
      }

    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']
