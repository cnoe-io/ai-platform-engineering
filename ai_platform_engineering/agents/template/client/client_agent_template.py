import json
from agent_template.models import ChatBotQuestion
import logging
import agent_template.logging_config
from httpx_sse import ServerSentEvent

import os
import asyncio
from agntcy_acp import AsyncACPClient, ApiClientConfiguration
from agntcy_acp.acp_v0.async_client.api_client import ApiClient as AsyncApiClient

from agntcy_acp.models import (
  RunCreateStateless,
  RunResult,
  RunError,
  Config,
)

# Host can't have trailing slash
API_PORT = os.getenv("API_PORT")
API_KEY = os.getenv("API_KEY")
client_config = ApiClientConfiguration(
  host=f"http://localhost:{API_PORT}", api_key={"x-api-key": f"{API_KEY}"}, retries=3
)


async def run_stateless(question: ChatBotQuestion, process_event):
  """
  Create a stateless run with the input spec from jarvis-agent.json and stream the output.
  Calls process_event(event, user_email) for each streamed event.
  """
  async with AsyncApiClient(client_config) as api_client:
    acp_client = AsyncACPClient(api_client)
    agent_id = os.getenv("AGENT_ID")
    if not agent_id:
      raise EnvironmentError("AGENT_ID environment variable is not set")

    # Compose input according to the input spec in jarvis-agent.json
    input_obj = {"messages": [{"type": "human", "content": question.question}], "is_completed": False}
    # Ensure all message types are valid
    for message in input_obj["messages"]:
        if message["type"] not in ["human", "assistant", "ai", "tool"]:
            raise ValueError(f"Invalid message type: {message['type']}")
    run_create = RunCreateStateless(
      agent_id=agent_id,
      input=input_obj,
      config=Config(),
    )
    # Create the stateless run and stream its output
    run_output = await acp_client.create_and_wait_for_stateless_run_output(run_create)
    print("***** Run Output *****")
    print(json.dumps(json.loads(run_output.json()), indent=2))
    print("***** End of Run Output *****")
    if run_output.output is None:
      raise Exception("Run output is None")
    actual_output = run_output.output.actual_instance
    if isinstance(actual_output, RunResult):
      run_result: RunResult = actual_output
    elif isinstance(actual_output, RunError):
      run_error: RunError = actual_output
      raise Exception(f"Run Failed: {run_error}")
    else:
      raise Exception(f"ACP Server returned a unsupported response: {run_output}")
    run_state = run_result.values  # type: ignore
    logging.info(run_state)
    if "messages" in run_state:
      for i, m in enumerate(run_state["messages"]):
        metadata = run_state.get("metadata", [{}] * len(run_state["messages"]))
        event = ServerSentEvent(
          event="data", data=json.dumps({"answer": m["content"], "metadata": metadata[i]})
        )
        await process_event(question.chat_id, event)    # run = await acp_client.create_stateless_run(run_create)
    # run_id = run.run_id
    # async for event in await acp_client.stream_stateless_run_output(run_id):
    #   process_event(event, user_email)

if __name__ == "__main__":
  async def process_event(chat_id, event):
    print(f"Chat ID: {chat_id}, Event: {event.event}, Data: {event.data}")

  question = ChatBotQuestion(
    question="where can I hike in Califronia?",
    chat_id="12345")
  # Run the stateless run
  loop = asyncio.get_event_loop()
  loop.run_until_complete(run_stateless(question, process_event))
  loop.close()
