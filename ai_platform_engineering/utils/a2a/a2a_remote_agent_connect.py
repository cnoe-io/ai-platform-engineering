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
logger.setLevel(logging.INFO)


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
      if trace_id:
          logger.info(f"A2ARemoteAgentConnectTool: Using provided trace_id: {trace_id}")
      else:
          # Get from TracingManager context - this is set by the trace decorator
          tracing = TracingManager()
          trace_id = tracing.get_trace_id() if tracing.is_enabled else None
          if trace_id:
              logger.info(f"A2ARemoteAgentConnectTool: Using trace_id from TracingManager context: {trace_id}")
          else:
              logger.warning("A2ARemoteAgentConnectTool: No trace_id available from any source")
      
      response = await self.send_message(prompt, trace_id)
      return Output(response=response)
    except Exception as e:
      logger.error(f"Failed to execute A2A client tool: {str(e)}")
      raise RuntimeError(f"Failed to execute A2A client tool: {str(e)}")

  async def send_message(self, prompt: str, trace_id: str = None) -> str:
    """
    Streams a message to the A2A agent, writes streaming chunks to the LangGraph
    stream writer, and returns a concatenated text response. Falls back to
    non-streaming if streaming fails.
    """
    if self._client is None:
      logger.info("A2AClient not initialized. Connecting now...")
      await self.connect()

    # Build message payload with optional trace_id in metadata
    message_payload = {
        'role': 'user',
        'parts': [{'kind': 'text', 'text': prompt}],
        'messageId': uuid4().hex,
    }

    if trace_id:
      message_payload['metadata'] = {'trace_id': trace_id}
      logger.info(f"Adding trace_id to A2A message: {trace_id}")

    send_message_payload = {'message': message_payload}

    # Try streaming first
    streaming_request = SendStreamingMessageRequest(
        id=str(uuid4()),
        params=MessageSendParams(**send_message_payload),
    )

    # Prepare writer and accumulator for final text
    try:
      writer = get_stream_writer()
    except Exception as e:
      logger.error(f'Unable to get writer: {e}')
      writer = None

    accumulated_texts: List[str] = []

    def extract_texts_from_stream_chunk(chunk_json) -> List[str]:
      texts: List[str] = []
      try:
        if isinstance(chunk_json, dict):
          result = chunk_json.get('result') or {}
          # Handle status-update shape (streaming)
          status = result.get('status')
          if isinstance(status, dict):
            message = status.get('message') or {}
            parts = message.get('parts') or []
            for p in parts:
              if isinstance(p, dict) and p.get('kind') == 'text':
                t = p.get('text')
                if isinstance(t, str):
                  texts.append(t)
          # Handle potential final-result shape (artifacts)
          artifacts = result.get('artifacts') or []
          for art in artifacts:
            parts = (art or {}).get('parts') or []
            for p in parts:
              if isinstance(p, dict) and p.get('kind') == 'text':
                t = p.get('text')
                if isinstance(t, str):
                  texts.append(t)
      except Exception as e:
        logging.debug(f"extract_texts_from_stream_chunk error: {e}")
      return texts

    def collect_texts_from_any(obj) -> List[str]:
      """
      Safely collect any 'text' fields from nested dict/list structures within a streaming chunk JSON.
      This is resilient to changing/mixed shapes of stream events.
      """
      texts: List[str] = []
      try:
        if isinstance(obj, dict):
          for k, v in obj.items():
            if k == "text" and isinstance(v, str):
              texts.append(v)
            else:
              texts.extend(collect_texts_from_any(v))
        elif isinstance(obj, list):
          for item in obj:
            texts.extend(collect_texts_from_any(item))
      except Exception as e:
        logging.info(f"collect_texts_from_any error: {e}")
      return texts

    try:
      logger.info(f"Sending streaming message request: {streaming_request}")
      stream = self._client.send_message_streaming(streaming_request)
      async for chunk in stream:
        logger.info(f'chunk: {chunk}')
        try:
          chunk_json = chunk.model_dump(mode='json', exclude_none=True)
        except Exception:
          try:
            chunk_json = chunk.dict(exclude_none=True)  # type: ignore[attr-defined]
          except Exception:
            chunk_json = str(chunk)

        if writer:
          try:
            writer({"a2a_stream": chunk_json})
          except Exception as e:
            logger.info(f"Failed to write full chunk to stream writer: {e}")

        # Prefer targeted extraction; fall back to generic recursive scan.
        delta_texts = extract_texts_from_stream_chunk(chunk_json)
        if not delta_texts:
          delta_texts = collect_texts_from_any(chunk_json)

        # Emit per-text deltas to the stream for immediate UI updates.
        if writer and delta_texts:
          for t in delta_texts:
            try:
              writer({"a2a_stream_text": t})
            except Exception as e:
              logger.debug(f"Failed to write text delta to stream: {e}")

        if delta_texts:
          accumulated_texts.extend(delta_texts)

      if accumulated_texts:
        return "".join(accumulated_texts)

      logger.info("Streaming completed but no text was extracted; falling back to non-streaming to retrieve final content.")

    except Exception as e:
      logger.warning(f"Streaming failed; falling back to non-streaming path: {e}", exc_info=True)

    # Fallback: non-streaming request to ensure we still return something
    request = SendMessageRequest(
        id=str(uuid4()),
        params=MessageSendParams(**send_message_payload),
    )
    logger.info(f"Request to send message (fallback): {request}")
    pprint.pprint(request)

    response = await self._client.send_message(request)
    logger.info(f"Response received from A2A agent (fallback): {response}")
    pprint.pprint(response)

    def extract_text_from_parts(artifacts):
      """Extract all text fields from artifact parts."""
      texts = []
      try:
        if not artifacts:
          logging.warning("Artifacts list is empty or None.")
          return texts

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

    if getattr(response.root, "result", None):
      texts = extract_text_from_parts(response.root.result.artifacts)
      logger.info(f"Extracted texts from artifacts (fallback): {texts}")
      return " ".join(texts)
    elif getattr(response.root, "error", None):
      raise Exception(f"A2A error: {response.root.error.message}")

    raise Exception("Unknown response type (fallback)")

  async def __aexit__(self, exc_type, exc_val, exc_tb):
    if self._httpx_client:
      await self._httpx_client.aclose()
