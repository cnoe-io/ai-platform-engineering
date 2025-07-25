# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import logging
from typing import Any, Optional, Union
from uuid import uuid4
from pydantic import PrivateAttr
import pprint

import httpx

from a2a.client import A2ACardResolver, A2AClient
from a2a.types import (
    AgentCard,
    SendMessageRequest,
    MessageSendParams,
)

from langchain_core.tools import BaseTool

from ai_platform_engineering.utils.models.generic_agent import Input, Output
from cnoe_agent_utils.tracing import TracingManager


logger = logging.getLogger("a2a.client.tool")


class A2ARemoteAgentConnectTool(BaseTool):
  """
  This tool sends a prompt to the A2A agent and returns the response.
  """
  name: str
  description: str

  _client = PrivateAttr()
  _agent_card = PrivateAttr()
  _httpx_client = PrivateAttr()

  def __init__(
      self,
      # Accept AgentCard or URL string
      remote_agent_card: Union[AgentCard, str],
      skill_id: str,
      access_token: Optional[str] = None,  # For extended card if needed
      **kwargs: Any,
  ):
    """
    Initializes the A2ARemoteAgentConnectTool.

    Args:
      remote_agent_card (AgentCard | str): The agent card OR URL for fetching the card.
      skill_id (str): The skill ID to invoke on the remote agent.
      access_token (Optional[str]): Bearer token for authenticated extended card, if needed.
    """
    super().__init__(**kwargs)
    self._remote_agent_card = remote_agent_card
    self._skill_id = skill_id
    self._client = None
    self._agent_card = None
    self._httpx_client = None
    self._access_token = access_token

  async def _connect(self):
    """
    Establishes a connection to the remote A2A agent.
    Fetches AgentCard if not already provided.
    """
    logger.info("*" * 80)
    logger.info(
        f"Connecting to remote agent: {
            getattr(
                self._remote_agent_card,
                'name',
                self._remote_agent_card)}")
    self._httpx_client = httpx.AsyncClient(timeout=httpx.Timeout(300.0))

    # If self._remote_agent_card is already an AgentCard, just use it
    if isinstance(self._remote_agent_card, AgentCard):
      self._agent_card = self._remote_agent_card
    else:
      base_url = self._remote_agent_card  # e.g. http://localhost:10000
      resolver = A2ACardResolver(
          httpx_client=self._httpx_client,
          base_url=base_url)
      try:
        _public_card = await resolver.get_agent_card()
        self._agent_card = _public_card
        logger.info("Successfully fetched public agent card.")
        if _public_card.supportsAuthenticatedExtendedCard and self._access_token:
          try:
            _extended_card = await resolver.get_agent_card(
                relative_card_path='/agent/authenticatedExtendedCard',
                http_kwargs={'headers': {'Authorization': f'Bearer {self._access_token}'}}
            )
            self._agent_card = _extended_card
            logger.info("Using authenticated extended agent card.")
          except Exception as e:
            logger.warning(
                f"Failed to fetch extended agent card: {e}. Using public card.")
      except Exception as e:
        logger.error(
            f"Failed to fetch agent card from {base_url}: {e}",
            exc_info=True)
        raise RuntimeError(
            f"Could not fetch remote agent card from {base_url}") from e

    logger.info(f"Agent Card: {self._agent_card}")
    self._client = A2AClient(
        httpx_client=self._httpx_client,
        agent_card=self._agent_card
    )
    logger.info("A2AClient initialized.")
    logger.info("*" * 80)

  def _run(self, input: Input) -> Any:
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
      # logger.info("\n" + "="*50 + "\nInput Received:\n" + f"{str(input)}" + "\n" + "="*50)
      print(type(input))  # Ensure input is validated by Pydantic
      prompt = input['prompt'] if isinstance(input, dict) else input.prompt
      logger.info(f"Received prompt: {prompt}")
      if not prompt:
        logger.error("Invalid input: Prompt must be a non-empty string.")
        raise ValueError("Invalid input: Prompt must be a non-empty string.")
      # Get current trace_id from tracing context
      tracing = TracingManager()
      trace_id = tracing.get_trace_id() if tracing.is_enabled else None
      
      response = await self.send_message(prompt, trace_id)
      return Output(response=response)
    except Exception as e:
      print(input)
      logger.error(f"Failed to execute A2A client tool: {str(e)}")
      raise RuntimeError(f"Failed to execute A2A client tool: {str(e)}")

  async def send_message(self, prompt: str, trace_id: str = None) -> str:
    """
    Sends a message to the A2A agent and invokes the specified skill.

    Args:
      prompt (str): The user input prompt to send to the agent.

    Returns:
      str: The response returned by the agent.
    """
    if self._client is None:
      logger.info("A2AClient not initialized. Connecting now...")
      await self._connect()

    # Build message payload with optional trace_id in metadata
    message_payload = {
        'role': 'user',
        'parts': [
            {'kind': 'text', 'text': prompt}
        ],
        'messageId': uuid4().hex,
    }
    
    # Add trace_id to metadata if provided
    if trace_id:
        message_payload['metadata'] = {'trace_id': trace_id}
        logger.info(f"Adding trace_id to A2A message: {trace_id}")
    
    send_message_payload = {'message': message_payload}
    # logger.info("Sending message to A2A agent with payload:\n" + json.dumps({**send_message_payload, 'message': send_message_payload['message'].dict()}, indent=4))
    request = SendMessageRequest(
        id=str(uuid4()),
        params=MessageSendParams(**send_message_payload)
    )

    logger.info(f"Request to send message: {request}")
    pprint.pprint(request)
    response = await self._client.send_message(request)
    logger.info(f"Response received from A2A agent: {response}")
    pprint.pprint(response)

    def extract_text_from_parts(artifacts):
      """Extract all text fields from artifact parts."""
      texts = []
      try:
        if not artifacts:
          logging.warning("Artifacts list is empty or None.")
          return texts

        # Handle if artifacts is a list, or single object (rare but possible)
        if not isinstance(artifacts, list):
          artifacts = [artifacts]

        for artifact in artifacts:
          parts = getattr(artifact, 'parts', None)
          if parts is None:
            logging.warning(f"No 'parts' found in artifact: {artifact}")
            continue

          for part in parts:
            root = getattr(part, 'root', None)
            if root is None:
              logging.warning(f"No 'root' found in part: {part}")
              continue

            text = getattr(root, 'text', None)
            if text is not None:
              texts.append(text)
            else:
              logging.info(f"No 'text' found in root: {root}")

      except AttributeError as e:
        logging.error(f"Attribute error while extracting text: {e}")
      except TypeError as e:
        logging.error(f"Type error while iterating: {e}")
      except Exception as e:
        logging.error(f"Unexpected error: {e}")

      return texts

    if response.root.result:
      texts = extract_text_from_parts(response.root.result.artifacts)
      logger.info(f"Extracted texts from artifacts: {texts}")
      return " ".join(texts)
    elif response.root.error:
      raise Exception(f"A2A error: {response.root.error.message}")

    raise Exception("Unknown response type")

  async def __aexit__(self, exc_type, exc_val, exc_tb):
    if self._httpx_client:
      await self._httpx_client.aclose()
