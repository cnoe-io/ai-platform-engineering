from typing import Any, Union
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
from pydantic import BaseModel, PrivateAttr
from langchain_core.tools import BaseTool

class Input(BaseModel):
    prompt: str

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

  async def send_message(self, message: str, role: Role = Role.user) -> Message:
    """
    Sends a message to the connected agent and returns the response.
    """
    logger.info(f"send_message called with message: '{message}', role: {role}")
    if self._client is None:
      logger.info("Client is not connected. Initiating connection.")
      logger.info("Client is None, calling _connect()")
      await self._connect()

    logger.info(f"Sending message to the agent: {message}")
    message_id = str(uuid4())
    request_id = str(uuid4())
    logger.info(f"Generated message ID: {message_id}, request ID: {request_id}")

    logger.info("Creating SendMessageRequest")
    request = SendMessageRequest(
      id=request_id,
      params=MessageSendParams(
        message=Message(
          messageId=message_id,
          role=role,
          parts=[Part(TextPart(text=message))]
        )
      )
    )
    logger.info(f"SendMessageRequest created: {request}")

    logger.info("Calling client.send_message()")
    response = await self._client.send_message(request)
    logger.info(f"Received response from the agent: {response}")
    logger.info(f"Response type: {type(response)}, response content: {response}")
    return response

  def _run(self, input: Input) -> Any:
    """
    Synchronous interface (not supported).
    """
    logger.info("_run called but not supported, raising NotImplementedError")
    raise NotImplementedError("Use _arun for async execution.")

  async def _arun(self, input: Input) -> Any:
    """
    Asynchronously sends a prompt to the A2A agent and returns the response.

    Args:
      input (Input): The input containing the prompt to send to the agent.

    Returns:
      Output: The response from the agent.
    """
    try:
      logger.info(f"Processing input of type: {type(input)}")
      logger.info(f"Input content: {input}")
      prompt = input['prompt'] if isinstance(input, dict) else input.prompt
      logger.info(f"Received prompt: {prompt}")
      logger.info(f"Extracted prompt: '{prompt}' (type: {type(prompt)})")
      if not prompt:
        logger.error("Invalid input: Prompt must be a non-empty string.")
        raise ValueError("Invalid input: Prompt must be a non-empty string.")
      logger.info("Calling send_message with extracted prompt")
      response = await self.send_message(prompt)
      logger.info(f"Successfully received response: {response}")
      logger.info(f"Creating Output with response: {response}")
      output = Output(response=response)
      logger.info(f"Output created: {output}")
      return output
    except Exception as e:
      logger.error(f"Failed to execute A2A client tool with input: {input}. Error: {str(e)}")
      logger.info(f"Exception details: {type(e).__name__}: {str(e)}", exc_info=True)
      raise RuntimeError(f"Failed to execute A2A client tool: {str(e)}")