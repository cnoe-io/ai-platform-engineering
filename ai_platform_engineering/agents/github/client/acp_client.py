# SPDX-License-Identifier: Apache-2.0

import json
from agent_argocd.models import ChatBotQuestion
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

from dotenv import load_dotenv
import uuid
import readline

# Load environment variables from a .env file
load_dotenv()

# Host can't have trailing slash
WFSM_PORT = os.getenv("WFSM_PORT")
API_KEY = os.getenv("API_KEY")

if not WFSM_PORT or not API_KEY:
    raise EnvironmentError("WFSM_PORT and API_KEY environment variables must be set")

client_config = ApiClientConfiguration(
  host=f"http://localhost:{WFSM_PORT}", api_key={"x-api-key": f"{API_KEY}"}, retries=3
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
    input_obj = {
      "argocd_input": {
        "messages": [
          {
            "type": "human",
            "content": question.question
          }
        ]
      },
      "is_completed": False
    }
    # Ensure all message types are valid
    run_create = RunCreateStateless(
      agent_id=agent_id,
      input=input_obj,
      config=Config(),
    )
    # Create the stateless run and stream its output
    run_output = await acp_client.create_and_wait_for_stateless_run_output(run_create)
    # print("***** Run Output *****")
    # print(json.dumps(json.loads(run_output.json()), indent=2))
    # print("***** End of Run Output *****")
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
    if run_state.get("argocd_output") and "messages" in run_state["argocd_output"]:
      # Extract the assistant message type and content
      for message in run_state["argocd_output"]["messages"]:
        if message["type"] == "assistant":
          assistant_content = message["content"]
          event = ServerSentEvent(
            event="data", data=json.dumps({"answer": assistant_content})
          )
          await process_event(event)

if __name__ == "__main__":
  async def process_event(event):
    event_data = json.loads(event.data)
    answer = event_data.get("answer", "No answer found")
    print(f"Agent: {answer}")

  async def chat_interface():
    print("Start chatting with the agent. Press Ctrl+C to exit.")
    history_file = os.path.expanduser("~/.chat_history")
    try:
      if os.path.exists(history_file):
        readline.read_history_file(history_file)
    except Exception as e:
      print(f"Could not load history file: {e}")

    try:
      while True:
        try:
          user_input = input("\n> Your Question: ")
          if user_input.strip().lower() in ["exit", "quit"]:
            print("Exiting chat.")
            break
          if user_input.strip():
            readline.add_history(user_input)
          question = ChatBotQuestion(
            question=user_input,
            chat_id=str(uuid.uuid4())
          )
          await run_stateless(question, process_event)
        except KeyboardInterrupt:
          print("\nExiting chat.")
          break
    finally:
      try:
        readline.write_history_file(history_file)
      except Exception as e:
        print(f"Could not save history file: {e}")

  asyncio.run(chat_interface())
