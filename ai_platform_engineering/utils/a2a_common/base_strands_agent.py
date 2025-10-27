# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Base agent class for Strands-based agents with A2A protocol support."""

import logging
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List, Tuple

from strands import Agent
from strands.tools.mcp import MCPClient

logger = logging.getLogger(__name__)


class BaseStrandsAgent(ABC):
    """
    Abstract base class for Strands-based agents with A2A protocol support.

    Provides common functionality for:
    - MCP client lifecycle management
    - Multi-server MCP support
    - Tool aggregation from multiple MCP servers
    - Strands agent creation
    - Conversation state management

    Subclasses must implement:
    - get_agent_name() - Return the agent's name
    - get_system_prompt() - Return the system prompt for the agent
    - create_mcp_clients() - Create and configure MCP clients
    - get_model_config() - Return the model configuration for Strands
    """

    def __init__(self, config: Optional[Any] = None):
        """
        Initialize the Strands-based agent.

        Args:
            config: Optional agent-specific configuration
        """
        self.config = config
        self._agent = None
        self._mcp_clients: List[MCPClient] = []
        self._mcp_contexts: List[Any] = []
        self._tools: List[Any] = []

        # Set up logging
        if config and hasattr(config, 'log_level'):
            log_level = config.log_level
            logging.getLogger("strands").setLevel(getattr(logging, log_level, logging.INFO))

        logger.info(f"Initializing {self.get_agent_name()} agent (Strands-based)")

        # Initialize MCP clients and agent
        self._initialize_mcp_and_agent()

    @abstractmethod
    def get_agent_name(self) -> str:
        """
        Return the agent's name for logging and tracing.

        Returns:
            Agent name as string
        """
        pass

    @abstractmethod
    def get_system_prompt(self) -> str:
        """
        Return the system prompt for the Strands agent.

        Returns:
            System prompt as string
        """
        pass

    @abstractmethod
    def create_mcp_clients(self) -> List[Tuple[str, MCPClient]]:
        """
        Create and configure MCP clients.

        This method should create MCPClient instances for each MCP server
        the agent needs to connect to.

        Returns:
            List of tuples containing (server_name, MCPClient)

        Example:
            ```python
            def create_mcp_clients(self) -> List[Tuple[str, MCPClient]]:
                clients = []

                # Create EKS MCP client
                eks_client = MCPClient(lambda: stdio_client(
                    StdioServerParameters(
                        command="uvx",
                        args=["awslabs.eks-mcp-server@latest"],
                        env={"AWS_REGION": "us-west-2"}
                    )
                ))
                clients.append(("eks", eks_client))

                return clients
            ```
        """
        pass

    @abstractmethod
    def get_model_config(self) -> Any:
        """
        Return the model configuration for the Strands agent.

        This can be a Strands Model instance (e.g., BedrockModel) or
        a configuration dict that Strands Agent can use.

        Returns:
            Model configuration for Strands Agent
        """
        pass

    def get_tool_working_message(self) -> str:
        """
        Return message to show when agent is calling tools.

        Can be overridden by subclasses for custom messages.

        Returns:
            Message string
        """
        return f"{self.get_agent_name()} is using tools..."

    def get_tool_processing_message(self) -> str:
        """
        Return message to show when agent is processing tool results.

        Can be overridden by subclasses for custom messages.

        Returns:
            Message string
        """
        return f"{self.get_agent_name()} is processing results..."

    def _initialize_mcp_and_agent(self):
        """Initialize MCP clients and create the Strands agent."""
        try:
            logger.info(f"Initializing MCP clients for {self.get_agent_name()} agent...")

            # Create MCP clients (possibly multiple)
            mcp_clients_with_names = self.create_mcp_clients()
            self._mcp_clients = [client for _, client in mcp_clients_with_names]

            # Handle case when no MCP clients are configured
            if not mcp_clients_with_names:
                logger.info(f"No MCP clients configured for {self.get_agent_name()} agent. Running without MCP tools.")
                self._tools = []
                # Create the Strands agent with no tools
                self._agent = self._create_strands_agent(self._tools)
                logger.info(f"{self.get_agent_name()} agent initialized successfully with {len(self._tools)} tools")
                return

            # Enter each MCP client context and aggregate tools
            aggregated_tools = []
            successful_clients = []
            for name, client in mcp_clients_with_names:
                try:
                    ctx = client.__enter__()
                    self._mcp_contexts.append(ctx)
                    successful_clients.append((name, client))
                    tools = client.list_tools_sync()
                    logger.info(f"Retrieved {len(tools)} tools from MCP server '{name}'")
                    aggregated_tools.extend(tools)
                except Exception as e:
                    logger.warning(f"Failed to initialize MCP server '{name}': {e}")
                    logger.info(f"Continuing without MCP server '{name}'")
            
            # Update the client list to only include successful ones
            self._mcp_clients = [client for _, client in successful_clients]

            # Deduplicate tools by name (last wins if duplicate)
            dedup = {}
            for t in aggregated_tools:
                tool_name = getattr(t, 'name', None) or getattr(t, 'tool_name', None)
                if tool_name:
                    dedup[tool_name] = t
                else:
                    # Fallback: append if name not resolvable
                    dedup[id(t)] = t
            self._tools = list(dedup.values())
            
            # Handle case where all MCP servers failed to initialize
            if not successful_clients:
                logger.warning("No MCP servers could be initialized. Agent will run without MCP capabilities.")
                self._tools = []
                self._agent = self._create_strands_agent(self._tools)
                logger.info(f"{self.get_agent_name()} agent initialized successfully with {len(self._tools)} tools")
                return
            
            logger.info(f"Total aggregated tools: {len(self._tools)} (from {len(successful_clients)} successful MCP servers)")

            # Create the Strands agent with all tools
            self._agent = self._create_strands_agent(self._tools)
            logger.info(f"{self.get_agent_name()} agent initialized successfully with {len(self._tools)} tools")

        except Exception as e:
            logger.error(f"Failed to initialize {self.get_agent_name()} agent: {e}")
            self._cleanup_mcp()
            raise

    def _create_strands_agent(self, tools: List[Any]) -> Agent:
        """
        Create the Strands agent with the provided tools.

        Args:
            tools: List of tools from MCP servers

        Returns:
            Strands Agent instance
        """
        system_prompt = self.get_system_prompt()
        model_config = self.get_model_config()

        try:
            # Support both positional and keyword argument for model config
            # Some Model classes (like BedrockModel) are passed as first positional arg
            # Others use model= keyword argument
            from strands.models import BedrockModel

            if isinstance(model_config, BedrockModel):
                # For BedrockModel, pass as first positional argument
                agent = Agent(
                    model_config,
                    tools=tools,
                    system_prompt=system_prompt
                )
            else:
                # For other configs, use keyword argument
                agent = Agent(
                    model=model_config,
                    tools=tools,
                    system_prompt=system_prompt
                )
            logger.info(f"Successfully created Strands agent for {self.get_agent_name()}")
            return agent

        except Exception as e:
            logger.warning(f"Failed to create agent with specified config: {e}")
            logger.info("Falling back to default agent configuration")
            return Agent(tools=tools, system_prompt=system_prompt)

    def _cleanup_mcp(self):
        """Clean up MCP client resources."""
        if self._mcp_contexts:
            logger.info(f"Cleaning up {len(self._mcp_contexts)} MCP client context(s)...")
            for idx, ctx in enumerate(self._mcp_contexts):
                try:
                    ctx.__exit__(None, None, None)
                    logger.info(f"MCP client {idx+1}/{len(self._mcp_clients)} cleaned up")
                except Exception as e:
                    logger.warning(f"Error cleaning up MCP client {idx+1}: {e}")
            self._mcp_contexts.clear()
            self._mcp_clients.clear()
            self._agent = None
            self._tools = []

    async def stream_chat(self, message: str):
        """
        Stream chat with the agent (async generator).

        Args:
            message: User's input message

        Yields:
            Streaming events from the agent, including:
            - {"data": "text"} for content chunks
            - {"tool_call": {"name": "...", "id": "..."}} for tool start
            - {"tool_result": {"name": "...", "is_error": bool}} for tool completion
            - {"error": "..."} for errors
        """
        try:
            # Ensure agent is initialized
            if self._agent is None or not self._mcp_clients:
                self._initialize_mcp_and_agent()

            logger.info(f"Streaming response for message: {message[:100]}...")

            full_response = ""
            current_tool = None
            
            async for event in self._agent.stream_async(message):
                # Log the raw event for debugging (debug level since it's verbose)
                logger.debug(f"Raw Strands event: {event}")
                
                # Check for tool usage indicators in the event
                # Strands SDK may emit events with tool information
                if "tool" in event:
                    tool_info = event["tool"]
                    if "name" in tool_info:
                        # Tool call started
                        current_tool = tool_info.get("name")
                        yield {
                            "tool_call": {
                                "name": current_tool,
                                "id": tool_info.get("id", current_tool),
                            }
                        }
                        logger.info(f"Tool call detected: {current_tool}")
                
                # Check for tool result indicators
                elif "tool_result" in event:
                    result_info = event["tool_result"]
                    tool_name = result_info.get("name", current_tool or "unknown")
                    is_error = result_info.get("error", False) or result_info.get("is_error", False)
                    
                    yield {
                        "tool_result": {
                            "name": tool_name,
                            "is_error": is_error,
                        }
                    }
                    logger.info(f"Tool result detected: {tool_name}, error={is_error}")
                    current_tool = None
                
                # Pass through regular data events
                elif "data" in event:
                    full_response += event["data"]
                    yield event
                
                # Pass through other events
                else:
                    yield event

        except Exception as e:
            error_message = f"Error streaming message: {str(e)}"
            logger.error(error_message)
            yield {"error": error_message}

    def chat(self, message: str) -> Dict[str, Any]:
        """
        Chat with the agent (non-streaming).

        Args:
            message: User's input message

        Returns:
            Dictionary containing the agent's response
        """
        try:
            # Ensure agent is initialized
            if self._agent is None or not self._mcp_clients:
                self._initialize_mcp_and_agent()

            logger.info(f"Processing message: {message[:100]}...")
            response = self._agent(message)

            # Extract response content from AgentResult
            response_text = str(response)

            return {
                "answer": response_text,
                "metadata": {
                    "tools_available": len(self._tools),
                    "agent_name": self.get_agent_name()
                }
            }

        except Exception as e:
            error_message = f"Error processing message: {str(e)}"
            logger.error(error_message)
            return {
                "answer": f"I encountered an error: {str(e)}",
                "metadata": {
                    "error": True,
                    "error_message": error_message
                }
            }

    def close(self):
        """Close the agent and clean up resources."""
        logger.info(f"Closing {self.get_agent_name()} agent and cleaning up resources...")
        self._cleanup_mcp()

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()

    def __del__(self):
        """Destructor to ensure proper cleanup."""
        try:
            self.close()
        except Exception:
            # Ignore errors during cleanup in destructor
            pass

