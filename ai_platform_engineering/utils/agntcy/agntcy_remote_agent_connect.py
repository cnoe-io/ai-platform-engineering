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
from agntcy_app_sdk.factory import GatewayFactory, ProtocolTypes
from agntcy_app_sdk.protocols.a2a.gateway import A2AProtocol

# Example Input/Output types for illustration (replace as needed)
from pydantic import BaseModel, PrivateAttr
from langchain_core.tools import BaseTool

class Input(BaseModel):
    prompt: str

class Output(BaseModel):
    response: Any

import logging
logger = logging.getLogger("AgntcyRemoteAgentConnectTool")

class AgntcyRemoteAgentConnectTool(BaseTool):
    """
    Connects to a remote agent using the SLIM transport and sends messages via the A2A protocol.
    """
    name: str = "agntcy-remote-agent-connect"
    description: str = (
        "Connects to a remote agent using the SLIM transport and sends messages via A2A protocol."
    )
    endpoint: str
    remote_agent_card: Union[AgentCard, str]
    _factory: GatewayFactory = PrivateAttr()
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
        if name is None:
            name = self.name
        if description is None:
            description = self.description
        super().__init__(
            endpoint=endpoint,
            remote_agent_card=remote_agent_card,
            name=name,
            description=description,
            **kwargs,
        )
        self._factory = GatewayFactory()
        self._transport = self._factory.create_transport("SLIM", endpoint=endpoint)
        self._client = None

    async def _connect(self):
        """
        Creates and stores a client connection to the remote agent.
        """
        a2a_topic = A2AProtocol.create_agent_topic(self.remote_agent_card)
        self._client = await self._factory.create_client(
            ProtocolTypes.A2A.value,
            agent_topic=a2a_topic,
            transport=self._transport
        )

    async def send_message(self, message: str, role: Role = Role.user) -> Message:
        """
        Sends a message to the connected agent and returns the response.
        """
        if self.client is None:
            await self._connect()

        request = SendMessageRequest(
            params=MessageSendParams(
                message=Message(
                    messageId="0",
                    role=role,
                    parts=[Part(TextPart(text=message))]
                )
            )
        )

        response = await self.client.send_message(request)
        return response

    def _run(self, input: Input) -> Any:
        """
        Synchronous interface (not supported).
        """
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
            print(type(input))  # Ensure input is validated by Pydantic
            prompt = input['prompt'] if isinstance(input, dict) else input.prompt
            logger.info(f"Received prompt: {prompt}")
            if not prompt:
                logger.error("Invalid input: Prompt must be a non-empty string.")
                raise ValueError("Invalid input: Prompt must be a non-empty string.")
            response = await self.send_message(prompt)
            return Output(response=response)
        except Exception as e:
            print(input)
            logger.error(f"Failed to execute A2A client tool: {str(e)}")
            raise RuntimeError(f"Failed to execute A2A client tool: {str(e)}")