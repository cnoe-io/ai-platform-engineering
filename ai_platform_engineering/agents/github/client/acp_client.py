# SPDX-License-Identifier: Apache-2.0

import json
import sys
from agent_slack.models import ChatBotQuestion
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

print("Using environment variables from shell:")


def check_environment():
    required_vars = ["WFSM_PORT", "API_KEY", "AGENT_ID", "GITHUB_PERSONAL_ACCESS_TOKEN"]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    
    if missing_vars:
        print("Missing required environment variables:")
        for var in missing_vars:
            print(f"  - {var}")
        return False
    
    # Check for newlines in API_KEY
    api_key = os.getenv("API_KEY", "")
    if "\n" in api_key or "\r" in api_key:
        print("Warning: API_KEY contains newlines. This may cause issues.")
        return False
    
    return True

# Debug print for environment variables
print("Environment variables in client:")
print(f"GITHUB_PERSONAL_ACCESS_TOKEN: {os.getenv('GITHUB_PERSONAL_ACCESS_TOKEN')}")
print(f"WFSM_PORT: {os.getenv('WFSM_PORT')}")
print(f"API_KEY: {os.getenv('API_KEY')}")
print(f"AGENT_ID: {os.getenv('AGENT_ID')}")

# Host can't have trailing slash
WFSM_PORT = os.getenv("WFSM_PORT", "").strip()
API_KEY = os.getenv("API_KEY", "").strip()

if not WFSM_PORT or not API_KEY:
    raise EnvironmentError("WFSM_PORT and API_KEY environment variables must be set")

client_config = ApiClientConfiguration(
    host=f"http://localhost:{WFSM_PORT}",
    api_key={"x-api-key": API_KEY},
    retries=3
)

async def run_stateless(question: ChatBotQuestion, process_event):
    """
    Create a stateless run with the input spec and stream the output.
    Calls process_event(event) for each streamed event.
    """
    try:
        async with AsyncApiClient(client_config) as api_client:
            acp_client = AsyncACPClient(api_client)
            agent_id = os.getenv("AGENT_ID", "").strip()
            if not agent_id:
                raise EnvironmentError("AGENT_ID environment variable is not set")

            # Print debug info about GitHub token before use
            github_token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN", "")
            if not github_token:
                print("Warning: GITHUB_PERSONAL_ACCESS_TOKEN is empty")
            else:
                print(f"Using GitHub token starting with: {github_token[:10]}...")

            # Compose input for GitHub agent with environment variables
            input_obj = {
                "github_input": {
                    "messages": [
                        {
                            "type": "human",
                            "content": question.question
                        }
                    ]
                },
                "is_completed": False,
                "env": {
                    "GITHUB_PERSONAL_ACCESS_TOKEN": github_token,
                    "GITHUB_HOST": os.getenv("GITHUB_HOST"),
                    "GITHUB_TOOLSETS": os.getenv("GITHUB_TOOLSETS"),
                    "GITHUB_DYNAMIC_TOOLSETS": os.getenv("GITHUB_DYNAMIC_TOOLSETS")
                }
            }

            run_create = RunCreateStateless(
                agent_id=agent_id,
                input=input_obj,
                config=Config(),
            )

            try:
                print("Sending request to ACP client...")
                run_output = await acp_client.create_and_wait_for_stateless_run_output(run_create)
                print("Received response from ACP client")
            except Exception as e:
                print(f"Error communicating with server: {str(e)}")
                print("Please ensure the server is running and accessible")
                return

            if run_output.output is None:
                print("Error: Run output is None")
                return

            actual_output = run_output.output.actual_instance
            if isinstance(actual_output, RunResult):
                run_result: RunResult = actual_output
            elif isinstance(actual_output, RunError):
                run_error: RunError = actual_output
                print(f"Run Failed: {run_error}")
                return
            else:
                print(f"Unexpected response type: {type(actual_output)}")
                return

            run_state = run_result.values
            if run_state.get("github_output") and "messages" in run_state["github_output"]:
                for message in run_state["github_output"]["messages"]:
                    if message["type"] == "assistant":
                        assistant_content = message["content"]
                        event = ServerSentEvent(
                            event="data",
                            data=json.dumps({"answer": assistant_content})
                        )
                        await process_event(event)
            else:
                print("No response messages found in output")
                print("Run state keys:", run_state.keys())

    except Exception as e:
        print(f"An error occurred: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    if not check_environment():
        sys.exit(1)

    async def process_event(event):
        event_data = json.loads(event.data)
        answer = event_data.get("answer", "No answer found")
        print(f"Agent: {answer}")

    async def chat_interface():
        print("Start chatting with the GitHub agent. Press Ctrl+C to exit.")
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