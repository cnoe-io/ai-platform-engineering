# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import logging
from typing import Any, Optional, Union, List
from uuid import uuid4
from pydantic import PrivateAttr
import pprint

import httpx

from a2a.client import A2ACardResolver, A2AClient
from a2a.types import (
    AgentCard,
    SendMessageRequest,
    SendStreamingMessageRequest,
    MessageSendParams,
)

from langchain_core.tools import BaseTool
from langgraph.config import get_stream_writer

from ai_platform_engineering.utils.models.generic_agent import Output
from cnoe_agent_utils.tracing import TracingManager
from pydantic import BaseModel, Field


logger = logging.getLogger("a2a.client.tool")


class A2AToolInput(BaseModel):
  """Input schema for A2A remote agent tool."""
  prompt: str = Field(description="The prompt to send to the agent")
  trace_id: Optional[str] = Field(default=None, description="Optional trace ID for distributed tracing")


class A2ARemoteAgentConnectTool(BaseTool):
  """
  This tool sends a prompt to the A2A agent and returns the response.
  Currently only supports single skill agents.
  TODO: Support multi-skill agents.
  """
  name: str
  description: str
  args_schema: type[BaseModel] = A2AToolInput

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

  async def connect(self):
    """
    Establishes a connection to the remote A2A agent.
    Fetches AgentCard if not already provided.
    """
    logger.info("*" * 80)
    logger.info(
        f"Connecting to remote agent: {getattr(self._remote_agent_card, 'name', self._remote_agent_card)}")
    self._httpx_client = httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(retries=10), timeout=httpx.Timeout(300.0))

    # If self._remote_agent_card is already an AgentCard, just use it
    if isinstance(self._remote_agent_card, AgentCard):
      logger.info(f"Using provided agent card for {self._remote_agent_card.name}")
      self._agent_card = self._remote_agent_card
      logger.info(f"Agent card: {self._agent_card}")
    else:
      base_url = self._remote_agent_card  # e.g. http://localhost:10000
      logger.info(f"Fetching agent card from {base_url}")
      resolver = A2ACardResolver(
          httpx_client=self._httpx_client,
          base_url=base_url)
      try:
        _public_card = await resolver.get_agent_card()
        self._agent_card = _public_card
        self.description = self._agent_card.description
        if not self._skill_id: # If skill_id is not provided, use the first skill
          self._skill_id = self._agent_card.skills[0].id

        logger.info(f"Successfully fetched public agent card for {self._remote_agent_card}.")
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

  def agent_card(self) -> AgentCard:
    return self._agent_card

  def get_skill_examples(self) -> List[str]:
    """
    Returns the examples for the skill that is invoked on the remote agent.
    """
    for skill in self._agent_card.skills:
      if skill.id == self._skill_id:
        return skill.examples
    return []

  def skill_id(self) -> str:
    """Returns the skill ID thats invoked on the remote agent."""
    return self._skill_id

  def _run(self, prompt: str, trace_id: Optional[str] = None) -> Any:
    raise NotImplementedError("Use _arun for async execution.")

  async def _arun(self, prompt: str, trace_id: Optional[str] = None) -> Any:
    """
    Asynchronously sends a prompt to the A2A agent and returns the response via streaming.
    Streams A2A events (Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent) using get_stream_writer.
    """
    try:
        logger.info(f"Received prompt: {prompt}, trace_id: {trace_id}")
        if not prompt:
            logger.error("Invalid input: Prompt must be a non-empty string.")
            raise ValueError("Invalid input: Prompt must be a non-empty string.")

        # Use provided trace_id or try to get from TracingManager context
        if trace_id:
            logger.info(f"A2ARemoteAgentConnectTool: Using provided trace_id: {trace_id}")
        else:
            tracing = TracingManager()
            trace_id = tracing.get_trace_id() if tracing.is_enabled else None
            if trace_id:
                logger.info(f"A2ARemoteAgentConnectTool: Using trace_id from TracingManager context: {trace_id}")
            else:
                logger.warning("A2ARemoteAgentConnectTool: No trace_id available from any source")

        if self._client is None:
            logger.info("A2AClient not initialized. Connecting now...")
            await self.connect()

        # Build message payload with optional trace_id in metadata
        message_payload: dict[str, Any] = {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": prompt}],
                "message_id": uuid4().hex,
            }
        }
        if trace_id:
            message_payload["message"]["metadata"] = {"trace_id": trace_id}
            logger.info(f"Adding trace_id to A2A message: {trace_id}")

        # Create streaming request
        streaming_request = SendStreamingMessageRequest(
            id=str(uuid4()),
            params=MessageSendParams(**message_payload),
        )

        # Prepare stream writer
        writer = get_stream_writer()
        logger.info("Starting A2A streaming send_message.")

        accumulated_text: list[str] = []

        async for chunk in self._client.send_message_streaming(streaming_request):
            try:
                chunk_dump = chunk.model_dump(mode="json", exclude_none=True)
            except Exception:
                chunk_dump = str(chunk)

            logger.debug(f"Received A2A stream chunk: {chunk_dump}")
            writer({"type": "a2a_event", "data": chunk_dump})

            try:
                # The chunk is a SendStreamingMessageResponse Pydantic object
                # The actual event data is in chunk.model_dump()['result']
                # We already dumped it above as chunk_dump
                result = chunk_dump.get('result') if isinstance(chunk_dump, dict) else None
                if not result:
                    logger.debug("No result in chunk, skipping")
                    continue

                # Get event kind
                kind = result.get('kind')
                if not kind:
                    logger.debug("No kind in result, skipping")
                    continue

                # Extract text from artifact-update events
                if kind == "artifact-update":
                    artifact = result.get('artifact')
                    if artifact and isinstance(artifact, dict):
                        parts = artifact.get('parts', [])
                        for part in parts:
                            if isinstance(part, dict):
                                text = part.get('text')
                                if text:
                                    accumulated_text.append(text)
                                    logger.debug(f"✅ Accumulated text from artifact-update: {len(text)} chars")

                # Extract text from status-update events (RAG agent streams via status messages)
                elif kind == "status-update":
                    status = result.get('status')
                    if status and isinstance(status, dict):
                        message = status.get('message')
                        if message and isinstance(message, dict):
                            parts = message.get('parts', [])
                            for part in parts:
                                if isinstance(part, dict):
                                    text = part.get('text')
                                    if text and not text.startswith(('🔧', '✅', '❌', '🔍')):
                                        accumulated_text.append(text)
                                        logger.debug(f"✅ Accumulated text from status-update: {len(text)} chars")
            except Exception as e:
                logger.warning(f"Non-fatal error while handling stream chunk: {e}")
                import traceback
                logger.warning(traceback.format_exc())

        # Concatenate tokens without adding extra spaces (tokens already include spaces)
        final_response = "".join(accumulated_text).strip()
        if not final_response:
            logger.info("No accumulated artifact text; falling back to non-streaming send_message to get result.")
            final_response = await self.send_message(prompt, trace_id)

        logger.info(f"Accumulated {len(accumulated_text)} tokens into {len(final_response)} char response")
        return Output(response=final_response)

    except Exception as e:
        logger.error(f"Failed to execute A2A client tool via streaming: {str(e)}")
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
      await self.connect()

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

    def extract_text_from_response(result):
      """
      Extract text from A2A response.
      Tries multiple locations in order:
      1. artifacts[].parts[].root.text (for agents that return artifacts)
      2. status.message.parts[].root.text (for agents that return status messages)
      3. history[] - last agent message (for agents that use message history)
      """
      texts = []

      try:
        # First, try extracting from artifacts
        artifacts = getattr(result, 'artifacts', None)
        if artifacts:
          logging.info("Attempting to extract text from artifacts...")
          if not isinstance(artifacts, list):
            artifacts = [artifacts]

          for artifact in artifacts:
            parts = getattr(artifact, 'parts', None)
            if parts:
              logging.info(f"Found {len(parts)} parts in artifact")
              for part in parts:
                # Try to get the root attribute (for Part objects with TextPart inside)
                root = getattr(part, 'root', None)
                if root:
                  text = getattr(root, 'text', None)
                  if text:
                    texts.append(text)
                    logging.info(f"Extracted text from artifact.part.root.text: {text[:100]}...")
                    continue

                # Fallback: check if part itself has text (for direct text parts)
                text = getattr(part, 'text', None)
                if text:
                  texts.append(text)
                  logging.info(f"Extracted text from artifact.part.text: {text[:100]}...")

        # If no artifacts found, try extracting from status.message
        if not texts:
          logging.info("No artifacts found, attempting to extract from status.message...")
          status = getattr(result, 'status', None)
          if status:
            message = getattr(status, 'message', None)
            if message:
              parts = getattr(message, 'parts', None)
              if parts:
                logging.info(f"Found {len(parts)} parts in status.message")
                for part in parts:
                  # Try to get the root attribute (for Part objects with TextPart inside)
                  root = getattr(part, 'root', None)
                  if root:
                    text = getattr(root, 'text', None)
                    if text:
                      texts.append(text)
                      logging.info(f"Extracted text from status.message.part.root.text: {text[:100]}...")
                      continue

                  # Fallback: check if part itself has text (for direct text parts)
                  text = getattr(part, 'text', None)
                  if text:
                    texts.append(text)
                    logging.info(f"Extracted text from status.message.part.text: {text[:100]}...")

        # If still no texts found, try extracting from history (last agent message)
        if not texts:
          logging.info("No texts in artifacts or status.message, attempting to extract from history...")
          history = getattr(result, 'history', None)
          if history and isinstance(history, list):
            logging.info(f"Found history with {len(history)} messages")
            # Get the last agent message (reverse order to find most recent)
            for message in reversed(history):
              role = getattr(message, 'role', None)
              # Look for agent messages (skip user messages and tool messages)
              if role and str(role) == 'Role.agent':
                parts = getattr(message, 'parts', None)
                if parts:
                  logging.info(f"Found {len(parts)} parts in last agent message from history")
                  for part in parts:
                    # Try to get the root attribute (for Part objects with TextPart inside)
                    root = getattr(part, 'root', None)
                    if root:
                      text = getattr(root, 'text', None)
                      if text:
                        # Skip tool status messages (🔧, ✅)
                        if not text.startswith('🔧') and not text.startswith('✅'):
                          texts.append(text)
                          logging.info(f"Extracted text from history.message.part.root.text: {text[:100]}...")

                    # Fallback: check if part itself has text (for direct text parts)
                    if not root:
                      text = getattr(part, 'text', None)
                      if text and not text.startswith('🔧') and not text.startswith('✅'):
                        texts.append(text)
                        logging.info(f"Extracted text from history.message.part.text: {text[:100]}...")

                # If we found texts in this agent message, stop looking
                if texts:
                  break

        if not texts:
          logging.warning("No text found in artifacts, status.message, or history")
          logging.warning(f"Result structure: artifacts={artifacts}, status={getattr(result, 'status', None)}")

      except Exception as e:
        logging.error(f"Error extracting text from response: {e}", exc_info=True)

      return texts

    if response.root.result:
      texts = extract_text_from_response(response.root.result)
      logger.info(f"Extracted texts: {[t[:100] + '...' if len(t) > 100 else t for t in texts]}")
      if texts:
        return " ".join(texts)
      else:
        logging.warning("No text extracted from response, returning empty string")
        return ""
    elif response.root.error:
      raise Exception(f"A2A error: {response.root.error.message}")

    raise Exception("Unknown response type")

  async def __aexit__(self, exc_type, exc_val, exc_tb):
    if self._httpx_client:
      await self._httpx_client.aclose()
