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

load_dotenv()

AGENT_NAME = os.getenv("AGENT_NAME", "PAGERDUTY").upper()

ACP_WORKFLOW_SERVER_PORT = os.getenv(f"CNOE_AGENT_{AGENT_NAME}_PORT")
API_KEY = os.getenv(f"CNOE_AGENT_{AGENT_NAME}_API_KEY")
AGENT_ID = os.getenv(f"CNOE_AGENT_{AGENT_NAME}_ID")

if not all([ACP_WORKFLOW_SERVER_PORT, API_KEY, AGENT_ID]):
    raise EnvironmentError(f"Required environment variables CNOE_AGENT_{AGENT_NAME}_PORT, CNOE_AGENT_{AGENT_NAME}_API_KEY, and CNOE_AGENT_{AGENT_NAME}_ID must be set")

client_config = ApiClientConfiguration(
    host=f"http://localhost:{ACP_WORKFLOW_SERVER_PORT}",
    api_key={"x-api-key": f"{API_KEY}"},
    retries=3,
)

async def handle_user_input(user_input: str):
    async with AsyncApiClient(client_config) as api_client:
        acp_client = AsyncACPClient(api_client)

        run_create = RunCreateStateless(
            agent_id=AGENT_ID,
            input={
                "pagerduty_input": {
                    "messages": [{"type": "human", "content": user_input}]
                },
                "is_completed": False,
            },
            config=Config(),
        )

        run_output = await acp_client.create_and_wait_for_stateless_run_output(run_create)
        if run_output.output is None:
            raise Exception("⚠️  Run output is None")

        actual_output = run_output.output.actual_instance
        if isinstance(actual_output, RunResult):
            if actual_output.values.get("pagerduty_output") and "messages" in actual_output.values["pagerduty_output"]:
                for message in actual_output.values["pagerduty_output"]["messages"]:
                    if message["type"] == "assistant":
                        render_answer(message["content"])
        elif isinstance(actual_output, RunError):
            raise Exception(f"❌ Run failed: {actual_output}")
        else:
            raise Exception(f"⚠️  Unexpected response type: {type(actual_output)}")

if __name__ == "__main__":
    asyncio.run(run_chat_loop(handle_user_input, title=f"ACP {AGENT_NAME} Agent")) 