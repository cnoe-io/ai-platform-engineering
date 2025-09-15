from typing import Any, Union, Optional, List
import asyncio
import os
from a2a.types import (
    AgentCard,
    SendMessageRequest,
    MessageSendParams,
    Message,
    Part,
    TextPart,
    Role,
)
from agntcy_app_sdk.factory import AgntcyFactory, ProtocolTypes
from agntcy_app_sdk.protocols.a2a.protocol import A2AProtocol

# Example Input/Output types for illustration (replace as needed)
from pydantic import BaseModel, PrivateAttr, Field
from langchain_core.tools import BaseTool

class AgntcyToolInput(BaseModel):
    """Input schema for Agntcy remote agent tool."""
    prompt: str = Field(description="The prompt to send to the agent")
    trace_id: Optional[str] = Field(default=None, description="Optional trace ID for distributed tracing")

class Output(BaseModel):
    response: Any

import logging
from uuid import uuid4
logger = logging.getLogger("AgntcySlimRemoteAgentConnectTool")

class AgntcySlimRemoteAgentConnectTool(BaseTool):
  """
  Connects to a remote agent using the SLIM transport and sends messages via the A2A protocol.
  """
  name: str = "agntcy-remote-agent-connect"
  description: str = (
    "Connects to a remote agent using the SLIM transport and sends messages via A2A protocol."
  )
  args_schema: type[BaseModel] = AgntcyToolInput
  endpoint: str
  remote_agent_card: Union[AgentCard, str]
  _factory: AgntcyFactory = PrivateAttr()
  _transport: Any = PrivateAttr()
  _client: Any = PrivateAttr(default=None)

  def __init__(
    self,
    endpoint: str,
    remote_agent_card: Union[AgentCard, str],
    name: str = None,
    description: str = None,
    **kwargs,
  ):
    logger.info(f"Initializing AgntcySlimRemoteAgentConnectTool with endpoint: {endpoint}")
    logger.info(f"Remote agent card type: {type(remote_agent_card)}")
    if name is None:
      name = self.name
    if description is None:
      description = self.description
    logger.info(f"Tool name: {name}, description: {description}")
    super().__init__(
      endpoint=endpoint,
      remote_agent_card=remote_agent_card,
      name=name,
      description=description,
      **kwargs,
    )
    logger.info("Creating AgntcyFactory instance")
    self._factory = AgntcyFactory()
    logger.info("Creating SLIM transport")
    self._transport = self._factory.create_transport("SLIM", endpoint=endpoint)
    self._client = None
    logger.info("AgntcySlimRemoteAgentConnectTool initialization complete")

  async def _connect(self):
    """
    Creates and stores a client connection to the remote agent.
    """
    logger.info("Establishing connection to the remote agent.")
    logger.info(f"Creating A2A topic for agent card: {self.remote_agent_card}")
    a2a_topic = A2AProtocol.create_agent_topic(self.remote_agent_card)
    logger.info(f"A2A topic created: {a2a_topic}")
    logger.info("Creating A2A client with factory")
    self._client = await self._factory.create_client(
      ProtocolTypes.A2A.value,
      agent_topic=a2a_topic,
      transport=self._transport
    )
    logger.info("Connection to the remote agent established successfully.")
    logger.info(f"Client instance created: {type(self._client)}")

  async def connect(self):
    """
    Public method to establish a connection, aligning with registry expectations.
    Enforces a timeout to avoid indefinite blocking during startup.
    """
    if self._client is not None:
      logger.info("Client already connected; skipping reconnect.")
      return

    # Allow override via env; default to a conservative timeout
    timeout_env = os.getenv("AGENT_CONNECT_TIMEOUT", "10")
    try:
      timeout_s = float(timeout_env)
    except ValueError:
      logger.warning(f"Invalid AGENT_CONNECT_TIMEOUT '{timeout_env}', falling back to 10s")
      timeout_s = 10.0

    logger.info(f"Connecting to the remote agent with timeout {timeout_s}s.")
    try:
      await asyncio.wait_for(self._connect(), timeout=timeout_s)
    except asyncio.TimeoutError:
      logger.error(f"Connection attempt timed out after {timeout_s}s")
      # Ensure client remains None on timeout so later send_message can retry
      self._client = None
      raise

  async def send_message(self, message: str, role: Role = Role.user, trace_id: Optional[str] = None) -> Message:
    """
    Sends a message to the connected agent and returns the response.
    """
    logger.info(f"send_message called with message: '{message}', role: {role}, trace_id: {trace_id}")
    if self._client is None:
      logger.info("Client is not connected. Initiating connection.")
      logger.info("Client is None, calling _connect()")
      timeout_env = os.getenv("AGENT_CONNECT_TIMEOUT", "10")
      try:
        timeout_s = float(timeout_env)
      except ValueError:
        logger.warning(f"Invalid AGENT_CONNECT_TIMEOUT '{timeout_env}', falling back to 10s")
        timeout_s = 10.0
      try:
        await asyncio.wait_for(self._connect(), timeout=timeout_s)
      except asyncio.TimeoutError:
        logger.error(f"Connection attempt timed out after {timeout_s}s in send_message")
        self._client = None
        raise

    logger.info(f"Sending message to the agent: {message}")
    message_id = str(uuid4())
    request_id = str(uuid4())
    logger.info(f"Generated message ID: {message_id}, request ID: {request_id}")

    logger.info("Creating SendMessageRequest")

    # Create message with optional metadata for trace_id
    message_parts = [Part(TextPart(text=message))]
    message_kwargs = {
      "messageId": str(uuid4()),
      "role": role,
      "parts": message_parts
    }

    # Add trace_id to metadata if provided (similar to A2A transport)
    if trace_id:
        message_kwargs["metadata"] = {"trace_id": trace_id}
        logger.info(f"Adding trace_id to Agntcy message metadata: {trace_id}")
    else:
        logger.info("No trace_id provided - message sent without trace metadata")

    request = SendMessageRequest(
      id=str(uuid4()),
      params=MessageSendParams(
        message=Message(**message_kwargs)
      )
    )

    response = await self._client.send_message(request)
    logger.info(f"Received response from the agent: {response}")
    return response

  # --- Compatibility helpers expected by registry/prompt code ---
  def agent_card(self) -> Any:
    """
    Return the agent card-like object. If an actual AgentCard was provided,
    return it; otherwise, return a lightweight object exposing at least
    a 'description' attribute for downstream consumers.
    """
    if isinstance(self.remote_agent_card, AgentCard):
      return self.remote_agent_card

    class _CardShim:
      def __init__(self, name: str, description: str):
        self.name = name
        self.description = description

    # Fall back to tool's own description
    return _CardShim(name=self.name, description=self.description)

  def get_skill_examples(self) -> List[str]:
    """
    Return example prompts from the agent card if available; otherwise empty.
    For multi-skill cards, flattens examples across all skills.
    """
    try:
      card = self.agent_card()
      skills = getattr(card, 'skills', []) or []
      examples: List[str] = []
      for skill in skills:
        ex = getattr(skill, 'examples', []) or []
        examples.extend(ex)
      return examples
    except Exception:
      return []

  def get_examples(self) -> List[str]:
    """
    Backwards-compatible alias expected by some registry utilities.
    """
    return self.get_skill_examples()

  def _run(self, prompt: str, trace_id: Optional[str] = None) -> Any:
    """
    Synchronous interface (not supported).
    """
    raise NotImplementedError("Use _arun for async execution.")

  async def _arun(self, prompt: str, trace_id: Optional[str] = None) -> Any:
    """
    Asynchronously sends a prompt to the A2A agent and returns the response.

    Args:
      prompt (str): The prompt to send to the agent.
      trace_id (Optional[str]): Optional trace ID for distributed tracing.

    Returns:
      Output: The response from the agent.
    """
    try:
      logger.info(f"Received prompt: {prompt}, trace_id: {trace_id}")
      if not prompt:
        logger.error("Invalid input: Prompt must be a non-empty string.")
        raise ValueError("Invalid input: Prompt must be a non-empty string.")

      # Use provided trace_id or try to get from TracingManager context
      if not trace_id:
        from cnoe_agent_utils.tracing import TracingManager
        tracing = TracingManager()
        trace_id = tracing.get_trace_id() if tracing.is_enabled else None
        if trace_id:
          logger.info(f"AgntcySlimRemoteAgentConnectTool: Using trace_id from TracingManager context: {trace_id}")

      if trace_id:
        logger.info(f"AgntcySlimRemoteAgentConnectTool: Using trace_id: {trace_id}")
      else:
        logger.warning("AgntcySlimRemoteAgentConnectTool: No trace_id available")

      response = await self.send_message(prompt, trace_id=trace_id)
      logger.info(f"Successfully received response: {response}")
      logger.info(f"Creating Output with response: {response}")
      output = Output(response=response)
      logger.info(f"Output created: {output}")
      return output
    except Exception as e:
      logger.error(f"Failed to execute A2A client tool with prompt: {prompt}. Error: {str(e)}")
      logger.info(f"Exception details: {type(e).__name__}: {str(e)}", exc_info=True)
      raise RuntimeError(f"Failed to execute A2A client tool: {str(e)}")