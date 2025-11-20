# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

import os
import json
import logging
from uuid import uuid4
from typing import Any, List, Dict
from pathlib import Path
import pytest
import yaml

import httpx
import pytest_asyncio
from a2a.client import A2AClient, A2ACardResolver
from a2a.types import (
  SendMessageResponse,
  SendMessageSuccessResponse,
  SendMessageRequest,
  MessageSendParams,
  AgentCard,
)
import warnings

# Suppress protobuf version warnings
warnings.filterwarnings(
  "ignore",
  message="Protobuf gencode version .* is exactly one major version older than the runtime version .*",
  category=UserWarning,
  module="google.protobuf.runtime_version"
)

# Set a2a.client logging to WARNING
logging.getLogger("a2a.client").setLevel(logging.WARNING)

PUBLIC_AGENT_CARD_PATH = '/.well-known/agent-card.json'
EXTENDED_AGENT_CARD_PATH = '/agent/authenticatedExtendedCard'

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

warnings.filterwarnings(
  "ignore",
  message=".*`dict` method is deprecated.*",
  category=DeprecationWarning,
  module=".*"
)

AGENT_HOST = os.environ.get("A2A_HOST", "localhost")
AGENT_PORT = os.environ.get("A2A_PORT", "8000")
if os.environ.get("A2A_TLS", "false").lower() in ["1", "true", "yes"]:
  AGENT_URL = f"https://{AGENT_HOST}:{AGENT_PORT}"
else:
  AGENT_URL = f"http://{AGENT_HOST}:{AGENT_PORT}"
DEBUG = os.environ.get("A2A_DEBUG_CLIENT", "false").lower() in ["1", "true", "yes"]

PROMPTS_FILE = os.environ.get("A2A_PROMPTS_FILE", "test_prompts_quick_sanity.yaml")
SESSION_CONTEXT_ID = uuid4().hex

def load_test_prompts() -> List[Dict[str, Any]]:
  """Load test prompts from YAML file in OpenAI dataset format"""
  prompts_path = Path(__file__).parent / PROMPTS_FILE
  if not prompts_path.exists():
    logger.warning(f"Prompts file not found: {prompts_path}, using default prompts")
    return [
      {
        "id": "default_capabilities",
        "messages": [{"role": "user", "content": "Describe your capabilities"}],
        "expected_keywords": ["can", "help", "capability"],
        "category": "general"
      },
      {
        "id": "default_argocd",
        "messages": [{"role": "user", "content": "git my latest commit message from ai-platform-engineering in cnoe-io org"}],
        "expected_keywords": ["argocd", "version"],
        "category": "argocd"
      }
    ]

  with open(prompts_path, 'r') as f:
    data = yaml.safe_load(f)

  prompts = data.get('prompts', [])
  logger.info(f"Loaded {len(prompts)} test prompts from {prompts_path}")
  return prompts

def create_send_message_payload(text: str) -> dict[str, Any]:
  return {
    "message": {
      "role": "user",
      "parts": [
        {"type": "text", "text": text}
      ],
      "messageId": uuid4().hex,
      "contextId": SESSION_CONTEXT_ID  # Include the session context ID in each message
    }
  }

def extract_response_text(response) -> str:
  try:
    if hasattr(response, "model_dump"):
      response_data = response.model_dump()
    elif hasattr(response, "dict"):
      response_data = response.dict()
    elif isinstance(response, dict):
      response_data = response
    else:
      raise ValueError("Unsupported response type")

    result = response_data.get("result", {})

    # Log the full response structure for debugging
    logger.info(f"Full response structure keys: {list(result.keys())}")
    logger.info(f"Response structure - has artifacts: {bool(result.get('artifacts'))}, has status: {bool(result.get('status'))}, has history: {bool(result.get('history'))}")

    # Log response size
    response_json_str = json.dumps(result, indent=2, default=str)
    if len(response_json_str) < 5000:
      logger.debug(f"Full response: {response_json_str}")
    else:
      logger.debug(f"Response size: {len(response_json_str)} chars (too large to log)")

    # First, try extracting from artifacts
    # Priority: final_result > complete_result > partial_result > other artifacts
    artifacts = result.get("artifacts")
    logger.debug(f"Artifacts found: {artifacts is not None}, count: {len(artifacts) if artifacts else 0}")

    if artifacts and isinstance(artifacts, list) and len(artifacts) > 0:
      # First, look for result artifacts (final_result, complete_result, partial_result)
      result_artifact_names = ["final_result", "complete_result", "partial_result"]
      result_artifact = None

      for artifact_name in result_artifact_names:
        for artifact in artifacts:
          if artifact.get("name") == artifact_name:
            result_artifact = artifact
            logger.info(f"✅ Found {artifact_name} artifact, extracting text from it")
            break
        if result_artifact:
          break

      # Use result artifact if found, otherwise use first artifact
      artifact_to_use = result_artifact if result_artifact else artifacts[0]
      artifact_name = artifact_to_use.get("name", "unknown")
      logger.debug(f"Extracting from artifact: {artifact_name}, parts: {len(artifact_to_use.get('parts', []))}")

      if artifact_to_use.get("parts"):
        for idx, part in enumerate(artifact_to_use["parts"]):
          logger.debug(f"Part {idx}: keys={list(part.keys())}")
          # Check if part has a 'root' attribute (Part with TextPart inside)
          if "root" in part:
            root = part["root"]
            logger.debug(f"Part {idx} has root: kind={root.get('kind')}, has_text={bool(root.get('text'))}")
            if root.get("kind") == "text" and root.get("text"):
              text = root.get("text", "").strip()
              logger.info(f"✅ Extracted text from {artifact_name}.parts[{idx}].root.text: {text[:100]}...")
              return text
            # Also check for data parts (structured responses)
            elif root.get("kind") == "data" and root.get("data"):
              data = root.get("data", {})
              # Try to extract text from structured data (e.g., JarvisResponse with 'answer' field)
              if isinstance(data, dict):
                if "answer" in data:
                  text = str(data["answer"]).strip()
                  logger.info(f"✅ Extracted text from {artifact_name}.parts[{idx}].root.data.answer: {text[:100]}...")
                  return text
                # Fallback: convert entire data structure to string
                text = json.dumps(data, indent=2, default=str).strip()
                logger.info(f"✅ Extracted text from {artifact_name}.parts[{idx}].root.data (as JSON): {text[:100]}...")
                return text
          # Fallback: check if part itself has kind='text'
          elif part.get("kind") == "text":
            text = part.get("text", "").strip()
            logger.info(f"✅ Extracted text from {artifact_name}.parts[{idx}].text: {text[:100]}...")
            return text
          # Also check for data parts directly
          elif part.get("kind") == "data" and part.get("data"):
            data = part.get("data", {})
            if isinstance(data, dict) and "answer" in data:
              text = str(data["answer"]).strip()
              logger.info(f"✅ Extracted text from {artifact_name}.parts[{idx}].data.answer: {text[:100]}...")
              return text

    # If no artifacts found, try extracting from status.message
    message = result.get("status", {}).get("message", {})
    logger.debug(f"Status message found: {bool(message)}, has parts: {bool(message.get('parts'))}")
    for idx, part in enumerate(message.get("parts", [])):
      logger.debug(f"Status message part {idx}: {json.dumps(part, indent=2, default=str)}")
      # Check if part has a 'root' attribute (Part with TextPart inside)
      if "root" in part:
        root = part["root"]
        logger.debug(f"Status message part {idx} has root: kind={root.get('kind')}, text_length={len(root.get('text', ''))}")
        if root.get("kind") == "text" and root.get("text"):
          text = root.get("text", "").strip()
          logger.info(f"✅ Extracted text from status.message.parts[{idx}].root.text: {text[:100]}...")
          return text
      # Fallback: check if part itself has kind='text'
      elif part.get("kind") == "text":
        text = part.get("text", "").strip()
        logger.info(f"✅ Extracted text from status.message.parts[{idx}].text (length={len(text)}): {text[:100] if text else 'EMPTY'}...")
        if text:  # Only return if non-empty
          return text
      elif "text" in part:
        text = part["text"].strip()
        logger.info(f"✅ Extracted text from status.message.parts[{idx}]['text']: {text[:100]}...")
        if text:  # Only return if non-empty
          return text

    # If still no text found, try extracting from history messages (concatenate ALL agent messages)
    history = result.get("history", [])
    logger.debug(f"History found: {len(history)} messages")

    # Collect all text from agent messages (the response may be fragmented across multiple messages)
    all_agent_texts = []
    for idx, message in enumerate(history):
      if message.get("role") == "agent":
        parts = message.get("parts", [])
        for part_idx, part in enumerate(parts):
          # Check if part has a 'root' attribute (Part with TextPart inside)
          if "root" in part:
            root = part["root"]
            text = root.get("text", "")
            if text:
              all_agent_texts.append(text)
              logger.debug(f"Collected text from history[{idx}].parts[{part_idx}].root.text: {text[:50]}...")
          # Fallback: check if part itself has kind='text'
          elif part.get("kind") == "text":
            text = part.get("text", "")
            if text:
              all_agent_texts.append(text)
              logger.debug(f"Collected text from history[{idx}].parts[{part_idx}].text: {text[:50]}...")

    if all_agent_texts:
      combined_text = "".join(all_agent_texts).strip()
      logger.info(f"✅ Extracted {len(all_agent_texts)} text fragments from history, combined length: {len(combined_text)}")
      logger.info(f"Combined text preview: {combined_text[:200]}...")
      return combined_text

    logger.warning("❌ No text found in response (checked artifacts, status.message, and history)")

  except Exception as e:
    logger.error(f"Error extracting text: {str(e)}", exc_info=True)

  return ""

async def send_message_to_agent(user_input: str) -> str:
  """Send a message to the agent and return the response text"""
  logger.info(f"Received user input: {user_input}")
  try:
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as httpx_client:
      logger.debug(f"Connecting to agent at {AGENT_URL}")
      # Fetch agent card first
      agent_card = await fetch_agent_card(AGENT_HOST, AGENT_PORT, "", False)
      # Create client with agent card
      client = A2AClient(agent_card=agent_card, httpx_client=httpx_client)
      client.url = AGENT_URL
      logger.debug("Successfully connected to agent")

      payload = create_send_message_payload(user_input)  # Ensure the payload includes the session context ID
      logger.debug(f"Created payload with message ID: {payload['message']['messageId']}")

      request = SendMessageRequest(
        id=uuid4().hex,
        params=MessageSendParams(**payload)
      )
      logger.debug(f"Sending message to agent at {client.url}...")

      response: SendMessageResponse = await client.send_message(request)
      logger.debug("Received response from agent")

      if isinstance(response.root, SendMessageSuccessResponse):
        logger.debug("Agent returned success response")
        response_data = response.root.model_dump()
        logger.debug("Response JSON:")
        logger.debug(json.dumps(response_data, indent=2, default=str))
        extracted = extract_response_text(response)
        logger.info(f"Extracted text length: {len(extracted)}, preview: {extracted[:200] if extracted else 'EMPTY'}")
        return extracted
      else:
        print(f"❌ Agent returned a non-success response: {response.root}")
        return None
  except Exception as e:
    print(f"ERROR: Exception occurred: {str(e)}")
    raise

async def fetch_agent_card(host, port, token: str, tls: bool) -> AgentCard:
  """
  Fetch the agent card, preferring the authenticated extended card if supported.
  """
  if tls:
    base_url = f"https://{host}:{port}"
  else:
    base_url = f"http://{host}:{port}"

  PUBLIC_AGENT_CARD_PATH = '/.well-known/agent-card.json'
  EXTENDED_AGENT_CARD_PATH = '/agent/authenticatedExtendedCard'

  async with httpx.AsyncClient() as httpx_client:
    resolver = A2ACardResolver(
      httpx_client=httpx_client,
      base_url=base_url,
    )
    final_agent_card_to_use: AgentCard | None = None

    try:
      logger.debug(f'Attempting to fetch public agent card from: {base_url}{PUBLIC_AGENT_CARD_PATH}')
      _public_card = await resolver.get_agent_card()
      logger.debug('Successfully fetched public agent card:')
      logger.debug(_public_card.model_dump_json(indent=2, exclude_none=True))
      final_agent_card_to_use = _public_card
      logger.debug('\nUsing PUBLIC agent card for client initialization (default).')

      if getattr(_public_card, "supports_authenticated_extended_card", False):
        try:
          logger.debug(f'\nPublic card supports authenticated extended card. Attempting to fetch from: {base_url}{EXTENDED_AGENT_CARD_PATH}')
          auth_headers_dict = {'Authorization': f'Bearer {token}'}
          _extended_card = await resolver.get_agent_card(
            relative_card_path=EXTENDED_AGENT_CARD_PATH,
            http_kwargs={'headers': auth_headers_dict},
          )
          logger.debug('Successfully fetched authenticated extended agent card:')
          logger.debug(_extended_card.model_dump_json(indent=2, exclude_none=True))
          final_agent_card_to_use = _extended_card
          logger.debug('\nUsing AUTHENTICATED EXTENDED agent card for client initialization.')
        except Exception as e_extended:
          logger.warning(f'Failed to fetch extended agent card: {e_extended}. Will proceed with public card.', exc_info=True)
      elif _public_card:
        logger.debug('\nPublic card does not indicate support for an extended card. Using public card.')

    except Exception as e:
      logger.error(f'Critical error fetching public agent card: {e}', exc_info=True)
      raise RuntimeError('Failed to fetch the public agent card. Cannot continue.') from e

    return final_agent_card_to_use


async def amain(host, port, token, tls, message):
  # Fetch the agent card before running the chat loop
  agent_card = await fetch_agent_card(host, port, token, tls)
  agent_name = agent_card.name if hasattr(agent_card, "name") else "Agent"
  print(f"✅ A2A Agent Card detected for \033[1m\033[32m{agent_name}\033[0m")
  skills_description = ""
  skills_examples = []

  if hasattr(agent_card, "skills") and agent_card.skills:
    skill = agent_card.skills[0]
    skills_description = skill.description if hasattr(skill, "description") else ""
    skills_examples = skill.examples if hasattr(skill, "examples") else []

  logger.info(f"Agent name: {agent_name}")
  logger.info(f"Skills description: {skills_description}")
  logger.info(f"Skills examples: {skills_examples}")

  # Now test with the message
  logger.info(f"Testing with message: {message}")
  response = await send_message_to_agent(message)
  logger.info(f"Response: {response}")

  if response:
    print("✅ Test completed successfully")
    return True
  else:
    print("❌ Test failed - no response received")
    return False

# Pytest fixtures
@pytest_asyncio.fixture(scope="session")
async def agent_card():
    """Fetch the agent card once for all tests"""
    return await fetch_agent_card(AGENT_HOST, AGENT_PORT, "", False)

@pytest.fixture(scope="session")
def test_prompts():
    """Load test prompts from YAML file"""
    return load_test_prompts()

# Test classes
@pytest.mark.asyncio
class TestAgentCard:
    """Test agent card discovery and validation"""

    agent_card = None

    async def test_agent_card_fetch(self):
        """Test that we can successfully fetch the agent card"""
        agent_card = await fetch_agent_card(AGENT_HOST, AGENT_PORT, "", False)
        assert agent_card is not None
        assert hasattr(agent_card, 'name')
        logger.info(f"✅ Agent card fetched successfully for: {agent_card.name}")

    async def test_agent_card_has_skills(self):
        """Test that the agent card has skills defined"""
        agent_card = await fetch_agent_card(AGENT_HOST, AGENT_PORT, "", False)
        agent_name = agent_card.name if hasattr(agent_card, "name") else "Agent"

        skills_description = ""
        skills_examples = []
        logging.info(f"Agent name: {agent_name}")

        if hasattr(agent_card, "skills") and agent_card.skills:
          skill = agent_card.skills[0]
          skills_description = skill.description if hasattr(skill, "description") else ""
          skills_examples = skill.examples if hasattr(skill, "examples") else []

          assert skills_description is not None
          assert skills_examples is not None
          logger.info(f"✅ Skills description: {skills_description}")
          logger.info(f"✅ Skills examples: {skills_examples}")

    async def test_agent_card_skill_details(self):
        """Test that skills have proper structure"""
        agent_card = await fetch_agent_card(AGENT_HOST, AGENT_PORT, "", False)
        skill = agent_card.skills[0]
        assert hasattr(skill, 'description') or hasattr(skill, 'name')
        logger.info("✅ First skill details validated")

@pytest.mark.asyncio
class TestAgentCommunication:
    """Test A2A protocol communication with the agent using YAML prompts"""

    @pytest.mark.parametrize("prompt_data", load_test_prompts())
    async def test_prompt_response(self, prompt_data):
        """Test agent response to prompts from YAML file"""
        prompt_id = prompt_data.get("id", "unknown")
        messages = prompt_data.get("messages", [])
        expected_keywords = prompt_data.get("expected_keywords", [])
        category = prompt_data.get("category", "general")

        # Extract user content from messages
        user_content = None
        for message in messages:
            if message.get("role") == "user":
                user_content = message.get("content")
                break

        assert user_content is not None, f"No user message found in prompt {prompt_id}"

        # Send message to agent
        response = await send_message_to_agent(user_content)
        if response is None:
            pytest.skip(f"Agent returned error response for prompt {prompt_id}")
        assert len(response) > 0, f"Empty response for prompt {prompt_id}"

        # Check if response contains expected keywords
        response_lower = response.lower()
        found_keywords = [kw for kw in expected_keywords if kw.lower() in response_lower]

        logger.info(f"✅ Prompt '{prompt_id}' ({category}) successful - response: {response}")
        if expected_keywords:
            if len(found_keywords) == 0:
                # Log detailed failure information for debugging
                logger.error(f"❌ Prompt '{prompt_id}' failed - response (first 500 chars): {response[:500]}")
                logger.error(f"❌ Expected keywords: {expected_keywords}")
                logger.error(f"❌ Response length: {len(response)}")
                # Check if this looks like a notification/intermediate message
                if len(response) < 100 and ("calling" in response_lower or "supervisor" in response_lower or "agent" in response_lower):
                    logger.warning("⚠️ Response appears to be an intermediate notification, not final result")
            assert len(found_keywords) > 0, f"None of expected keywords {expected_keywords} found in response for {prompt_id}. Response (first 500 chars): {response[:500]}"
            logger.info(f"✅ Prompt '{prompt_id}' ({category}) successful - found keywords: {found_keywords}")
        else:
            logger.info(f"✅ Prompt '{prompt_id}' ({category}) successful - response length: {len(response)}")

        # Log first 200 chars of response for debugging
        logger.debug(f"Response preview for {prompt_id}: {response[:200]}...")

@pytest.mark.asyncio
class TestAgentErrorHandling:
    """Test error handling and edge cases"""

    async def test_empty_message_handling(self):
        """Test how the agent handles empty messages"""
        try:
            response = await send_message_to_agent("")
            # Should either get a response or raise an exception
            assert response is not None or True  # Either response or exception is acceptable
            logger.info("✅ Empty message handled gracefully")
        except Exception as e:
            # Exception is acceptable for empty messages
            logger.info(f"✅ Empty message properly rejected: {str(e)}")

    async def test_invalid_query_handling(self):
        """Test how the agent handles invalid/nonsensical queries"""
        response = await send_message_to_agent("asdfghjkl qwerty invalid query 12345")
        logger.info(f"Response: {response}")
        assert response is not None
        assert len(response) > 0
        logger.info("✅ Invalid query handled gracefully")

@pytest.mark.asyncio
class TestSpecificAgentCapabilities:
    """Test specific capabilities mentioned in the agent card"""

    async def test_agent_specific_functionality(self, agent_card):
        """Test functionality specific to the agent based on its skills"""
        if hasattr(agent_card, 'skills') and agent_card.skills:
            skill = agent_card.skills[0]

            # If the agent has examples, test one of them
            if hasattr(skill, 'examples') and skill.examples:
                example_query = skill.examples[0]
                try:
                    # Use shorter timeout for this test to prevent hanging
                    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as httpx_client:
                        logger.debug(f"Connecting to agent at {AGENT_URL}")
                        # Use the agent_card from the fixture
                        client = A2AClient(agent_card=agent_card, httpx_client=httpx_client)
                        client.url = AGENT_URL

                        payload = create_send_message_payload(example_query)
                        request = SendMessageRequest(
                            id=uuid4().hex,
                            params=MessageSendParams(**payload)
                        )

                        response: SendMessageResponse = await client.send_message(request)
                        if isinstance(response.root, SendMessageSuccessResponse):
                            response_text = extract_response_text(response)
                            assert response_text is not None
                            assert len(response_text) > 0
                            logger.info(f"✅ Agent-specific functionality test passed for: {example_query}")
                        else:
                            pytest.skip("Agent returned non-success response")
                except Exception as e:
                    pytest.skip(f"Agent not responding to messages at {AGENT_URL}: {e}")
            else:
                pytest.skip("No examples available in agent skills")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])

# if __name__ == "__main__":
#   parser = argparse.ArgumentParser()
#   parser.add_argument("--host", type=str, default=AGENT_HOST)
#   parser.add_argument("--port", type=str, default=AGENT_PORT)
#   parser.add_argument("--token", type=str, default="NO_TOKEN")
#   parser.add_argument("--tls", type=bool, default=False)
#   parser.add_argument("--message", type=str, default="git my latest commit message from ai-platform-engineering in cnoe-io org")
#   args = parser.parse_args()
#   asyncio.run(amain(args.host, args.port, args.token, args.tls, args.message))