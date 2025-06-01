# SPDX-License-Identifier: Apache-2.0

import os
import json
import uuid
import asyncio
from dotenv import load_dotenv
from rich.console import Console
from httpx_sse import ServerSentEvent
from chat_interface import run_chat_loop, render_answer

from agntcy_acp import AsyncACPClient, ApiClientConfiguration
from agntcy_acp.acp_v0.async_client.api_client import ApiClient as AsyncApiClient
from agntcy_acp.models import RunCreateStateless, RunResult, RunError, Config

# Load environment variables from a .env file
load_dotenv()

# Get agent name and construct environment variable names
AGENT_NAME = os.getenv("AGENT_NAME", "slack").lower()
WFSM_PORT = os.getenv(f"CNOE_AGENT_{AGENT_NAME.upper()}_PORT")
API_KEY = os.getenv(f"CNOE_AGENT_{AGENT_NAME.upper()}_API_KEY")
AGENT_ID = os.getenv(f"CNOE_AGENT_{AGENT_NAME.upper()}_ID")

if not WFSM_PORT or not API_KEY or not AGENT_ID:
    raise EnvironmentError(f"CNOE_AGENT_{AGENT_NAME.upper()}_PORT, CNOE_AGENT_{AGENT_NAME.upper()}_API_KEY, and CNOE_AGENT_{AGENT_NAME.upper()}_ID environment variables must be set")

client_config = ApiClientConfiguration(
    host=f"http://localhost:{WFSM_PORT}", 
    api_key={"x-api-key": f"{API_KEY}"}, 
    retries=3
)

async def handle_user_input(user_input: str):
    """Handle user input and get response from the agent."""
    async with AsyncApiClient(client_config) as api_client:
        acp_client = AsyncACPClient(api_client)

        # Keep the original input structure but without exposing tokens
        input_obj = {
            "slack_input": {
                "messages": [
                    {
                        "type": "human",
                        "content": user_input
                    }
                ]
            },
            "is_completed": False
        }

        # Create configuration with Slack tokens
        config = Config(
            configurable={
                "slack_bot_token": os.getenv("SLACK_BOT_TOKEN"),
                "slack_app_token": os.getenv("SLACK_APP_TOKEN"),
                "slack_signing_secret": os.getenv("SLACK_SIGNING_SECRET"),
                "slack_client_secret": os.getenv("SLACK_CLIENT_SECRET"),
                "slack_team_id": os.getenv("SLACK_TEAM_ID")
            }
        )

        run_create = RunCreateStateless(
            agent_id=AGENT_ID,
            input=input_obj,
            config=config
        )

        try:
            run_output = await acp_client.create_and_wait_for_stateless_run_output(run_create)
            if run_output.output is None:
                raise Exception("Run output is None")

            actual_output = run_output.output.actual_instance
            if isinstance(actual_output, RunResult):
                # Try both output paths - first the ArgoCD style, then the Slack style
                messages = actual_output.values.get("output", {}).get("messages", [])
                if not messages:
                    # Fall back to slack_output if output.messages is empty
                    messages = actual_output.values.get("slack_output", {}).get("messages", [])
                
                for message in messages:
                    if message["type"] == "assistant":
                        render_answer(message["content"])
            elif isinstance(actual_output, RunError):
                raise Exception(f"Run Failed: {actual_output}")
            else:
                raise Exception(f"Unexpected response type: {type(actual_output)}")

        except Exception as e:
            print(f"Error: {str(e)}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(run_chat_loop(handle_user_input, title="Slack Agent Chat"))