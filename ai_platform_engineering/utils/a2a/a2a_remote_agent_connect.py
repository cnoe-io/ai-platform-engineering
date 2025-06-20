# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import logging
import time
from typing import Any, Optional, Union
from uuid import uuid4
from pydantic import PrivateAttr
import pprint

import httpx
from opentelemetry import trace

from a2a.client import A2ACardResolver, A2AClient
from a2a.types import (
    AgentCard,
    SendMessageRequest,
    MessageSendParams,
)

from langchain_core.tools import BaseTool

from ai_platform_engineering.utils.models.generic_agent import Input, Output
from ai_platform_engineering.utils.tracing import PhoenixTracing, get_current_trace_id, get_current_span_id


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
    # Get tracer for connection spans
    tracer = PhoenixTracing.get_tracer()
    
    with tracer.start_as_current_span("a2a_agent_connection") as connection_span:
      agent_name = getattr(self._remote_agent_card, 'name', str(self._remote_agent_card))
      connection_span.set_attribute("agent.name", agent_name)
      connection_span.set_attribute("connection.type", "a2a")
      
      logger.info(f"Connecting to remote agent: {agent_name}")
      
      start_time = time.time()
      self._httpx_client = httpx.AsyncClient(timeout=httpx.Timeout(120.0))

      # If self._remote_agent_card is already an AgentCard, just use it
      if isinstance(self._remote_agent_card, AgentCard):
        self._agent_card = self._remote_agent_card
        connection_span.set_attribute("agent_card.source", "provided")
        connection_span.set_attribute("agent.url", self._agent_card.url)
        connection_span.set_attribute("agent.version", self._agent_card.version)
      else:
        base_url = self._remote_agent_card  # e.g. http://localhost:10000
        connection_span.set_attribute("agent_card.source", "fetched")
        connection_span.set_attribute("agent.base_url", base_url)
        
        with tracer.start_as_current_span("agent_card_fetch") as fetch_span:
          fetch_span.set_attribute("fetch.url", base_url)
          
          resolver = A2ACardResolver(
              httpx_client=self._httpx_client,
              base_url=base_url)
          try:
            fetch_start = time.time()
            _public_card = await resolver.get_agent_card()
            fetch_duration = (time.time() - fetch_start) * 1000
            
            self._agent_card = _public_card
            fetch_span.set_attribute("fetch.success", True)
            fetch_span.set_attribute("fetch.duration_ms", fetch_duration)
            fetch_span.set_attribute("agent.name", _public_card.name)
            fetch_span.set_attribute("agent.version", _public_card.version)
            logger.info("Successfully fetched public agent card.")
            
            if _public_card.supportsAuthenticatedExtendedCard and self._access_token:
              with tracer.start_as_current_span("extended_card_fetch") as ext_span:
                try:
                  ext_start = time.time()
                  _extended_card = await resolver.get_agent_card(
                      relative_card_path='/agent/authenticatedExtendedCard',
                      http_kwargs={'headers': {'Authorization': f'Bearer {self._access_token}'}}
                  )
                  ext_duration = (time.time() - ext_start) * 1000
                  
                  self._agent_card = _extended_card
                  ext_span.set_attribute("extended_fetch.success", True)
                  ext_span.set_attribute("extended_fetch.duration_ms", ext_duration)
                  logger.info("Using authenticated extended agent card.")
                except Exception as e:
                  ext_span.set_attribute("extended_fetch.success", False)
                  ext_span.set_attribute("extended_fetch.error", str(e))
                  logger.warning(
                      f"Failed to fetch extended agent card: {e}. Using public card.")
          except Exception as e:
            fetch_span.set_attribute("fetch.success", False)
            fetch_span.set_attribute("fetch.error", str(e))
            fetch_span.record_exception(e)
            logger.error(
                f"Failed to fetch agent card from {base_url}: {e}",
                exc_info=True)
            raise RuntimeError(
                f"Could not fetch remote agent card from {base_url}") from e

      # Initialize A2A Client
      self._client = A2AClient(
          httpx_client=self._httpx_client,
          agent_card=self._agent_card
      )
      
      # Record final connection attributes
      connection_duration = (time.time() - start_time) * 1000
      connection_span.set_attribute("connection.duration_ms", connection_duration)
      connection_span.set_attribute("connection.success", True)
      connection_span.set_attribute("agent.capabilities", str(self._agent_card.capabilities))
      connection_span.set_attribute("agent.skills_count", len(self._agent_card.skills))
      
      logger.info(f"A2A connection established to {agent_name} in {connection_duration:.2f}ms")

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
      response = await self.send_message(prompt)
      return Output(response=response)
    except Exception as e:
      print(input)
      logger.error(f"Failed to execute A2A client tool: {str(e)}")
      raise RuntimeError(f"Failed to execute A2A client tool: {str(e)}")

  async def send_message(self, prompt: str) -> str:
    """
    Sends a message to the A2A agent and invokes the specified skill.

    Args:
      prompt (str): The user input prompt to send to the agent.

    Returns:
      str: The response returned by the agent.
    """
    # Get tracer for message sending spans
    tracer = PhoenixTracing.get_tracer()
    
    # Create comprehensive span for the entire agent interaction
    agent_name = getattr(self._agent_card, 'name', 'unknown') if self._agent_card else 'unknown'
    
    with tracer.start_as_current_span(f"{agent_name}_execution") as agent_span:
      # Add rich attributes for the agent interaction
      agent_span.set_attribute("agent.name", agent_name)
      agent_span.set_attribute("agent.skill_id", self._skill_id)
      agent_span.set_attribute("input.prompt", prompt[:200])  # Truncate for privacy
      agent_span.set_attribute("input.prompt_length", len(prompt))
      agent_span.set_attribute("parent_trace.id", get_current_trace_id() or "unknown")
      agent_span.set_attribute("parent_span.id", get_current_span_id() or "unknown")
      
      start_time = time.time()
      
      try:
        # Ensure connection is established
        if self._client is None:
          logger.info("A2AClient not initialized. Connecting now...")
          await self._connect()

        # Message preparation span
        with tracer.start_as_current_span("message_preparation") as prep_span:
          message_id = uuid4().hex
          send_message_payload = {
              'message': {
                  'role': 'user',
                  'parts': [
                      {'kind': 'text', 'text': prompt}
                  ],
                  'messageId': message_id,
                  # Extended with trace context for future agent implementations
                  'metadata': {
                      'trace_id': get_current_trace_id(),
                      'span_id': get_current_span_id(),
                      'source_agent': 'platform_engineer'
                  }
              },
          }
          
          request = SendMessageRequest(
              id=str(uuid4()),
              params=MessageSendParams(**send_message_payload)
          )
          
          prep_span.set_attribute("message.id", message_id)
          prep_span.set_attribute("request.id", request.id)
          prep_span.set_attribute("message.parts_count", len(send_message_payload['message']['parts']))

        # A2A message send span  
        with tracer.start_as_current_span("a2a_message_send") as send_span:
          send_span.set_attribute("agent.url", self._agent_card.url if self._agent_card else "unknown")
          send_span.set_attribute("message.id", message_id)
          send_span.set_attribute("request.id", request.id)
          
          send_start = time.time()
          logger.info(f"Sending message to {agent_name}: {prompt[:50]}...")
          
          response = await self._client.send_message(request)
          
          send_duration = (time.time() - send_start) * 1000
          send_span.set_attribute("send.duration_ms", send_duration)
          send_span.set_attribute("send.success", True)
          logger.info(f"Received response from {agent_name} in {send_duration:.2f}ms")

        # Response processing span
        with tracer.start_as_current_span("response_processing") as process_span:
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

              process_span.set_attribute("artifacts.count", len(artifacts))

              for i, artifact in enumerate(artifacts):
                parts = getattr(artifact, 'parts', None)
                if parts is None:
                  logging.warning(f"No 'parts' found in artifact: {artifact}")
                  continue

                process_span.set_attribute(f"artifact_{i}.parts_count", len(parts))

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
              process_span.set_attribute("processing.error", str(e))
            except TypeError as e:
              logging.error(f"Type error while iterating: {e}")
              process_span.set_attribute("processing.error", str(e))
            except Exception as e:
              logging.error(f"Unexpected error: {e}")
              process_span.set_attribute("processing.error", str(e))

            return texts

          if response.root.result:
            texts = extract_text_from_parts(response.root.result.artifacts)
            result_text = " ".join(texts)
            
            process_span.set_attribute("response.success", True)
            process_span.set_attribute("response.text_parts", len(texts))
            process_span.set_attribute("response.total_length", len(result_text))
            process_span.set_attribute("response.preview", result_text[:100])
            
            # Add success attributes to main agent span
            agent_span.set_attribute("execution.status", "success")
            agent_span.set_attribute("response.length", len(result_text))
            
            logger.info(f"Successfully processed response from {agent_name}: {len(texts)} text parts")
            return result_text
            
          elif response.root.error:
            error_msg = response.root.error.message
            process_span.set_attribute("response.success", False)
            process_span.set_attribute("response.error", error_msg)
            agent_span.set_attribute("execution.status", "error")
            agent_span.set_attribute("error.message", error_msg)
            raise Exception(f"A2A error from {agent_name}: {error_msg}")

          else:
            process_span.set_attribute("response.success", False)
            process_span.set_attribute("response.error", "unknown_response_type")
            agent_span.set_attribute("execution.status", "error")
            agent_span.set_attribute("error.message", "unknown_response_type")
            raise Exception(f"Unknown response type from {agent_name}")
            
      except Exception as e:
        # Record error in spans
        agent_span.set_attribute("execution.status", "error")
        agent_span.set_attribute("error.type", type(e).__name__)
        agent_span.set_attribute("error.message", str(e))
        agent_span.record_exception(e)
        logger.error(f"Failed to send message to {agent_name}: {e}")
        raise
        
      finally:
        # Record final timing
        total_duration = (time.time() - start_time) * 1000
        agent_span.set_attribute("execution.duration_ms", total_duration)
        logger.info(f"Agent {agent_name} execution completed in {total_duration:.2f}ms")

  async def __aexit__(self, exc_type, exc_val, exc_tb):
    if self._httpx_client:
      await self._httpx_client.aclose()
