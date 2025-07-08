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

AGENT_NAME = os.getenv("AGENT_NAME").upper()

ACP_WORKFLOW_SERVER_PORT = os.getenv(f"CNOE_AGENT_{AGENT_NAME}_PORT")
API_KEY = os.getenv(f"CNOE_AGENT_{AGENT_NAME}_API_KEY")
AGENT_ID = os.getenv(f"CNOE_AGENT_{AGENT_NAME}_ID")

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
                "input": {
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
            messages = actual_output.values.get("output", {}).get("messages", [])
            for m in messages:
                if m["type"] == "assistant":
                    render_answer(m["content"])
        elif isinstance(actual_output, RunError):
            raise Exception(f"❌ Run failed: {actual_output}")

if __name__ == "__main__":
    agent_name = os.getenv("AGENT_NAME", "")
    asyncio.run(run_chat_loop(handle_user_input, title=f"ACP {agent_name} Agent"))
