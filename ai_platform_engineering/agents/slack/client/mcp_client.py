# SPDX-License-Identifier: Apache-2.0

import os
import json
import asyncio
import uuid
import httpx
from sseclient import SSEClient
from chat_interface import run_chat_loop, render_answer

# === Environment Configuration ===
AGENT_NAME = os.getenv("AGENT_NAME", "Slack MCP Client")
MCP_HOST = os.getenv("MCP_HOST", "localhost")
MCP_PORT = os.getenv("MCP_PORT", "9000")
MCP_SERVER_URL = f"http://{MCP_HOST}:{MCP_PORT}"

# === MCP Endpoints ===
EVENT_STREAM_ENDPOINT = f"{MCP_SERVER_URL}/mcp/events"
REQUEST_ENDPOINT = f"{MCP_SERVER_URL}/mcp/request"

# === Task Coordination Map ===
RESPONSE_QUEUE: dict[str, asyncio.Queue] = {}

# === Send Request to MCP Server ===
async def send_request(input_text: str, context_id: str | None = None) -> str:
    task_id = str(uuid.uuid4())

    payload = {
        "task_id": task_id,
        "context_id": context_id,
        "input": {
            "text": input_text
        }
    }

    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(REQUEST_ENDPOINT, json=payload)
            r.raise_for_status()
        except Exception as e:
            render_answer(f"❌ Failed to send request: {e}")
            return ""

    queue = asyncio.Queue()
    RESPONSE_QUEUE[task_id] = queue
    response = await queue.get()
    del RESPONSE_QUEUE[task_id]

    return response.get("slack_output", {}).get("message", "")

# === Listen for Server-Sent Events ===
async def listen_for_events():
    def _run_sync_sse():
        with httpx.Client(timeout=None) as client:
            resp = client.get(EVENT_STREAM_ENDPOINT, stream=True)
            resp.raise_for_status()
            return SSEClient(resp)

    loop = asyncio.get_event_loop()
    while True:
        try:
            client_events = await loop.run_in_executor(None, _run_sync_sse)
            for event in client_events:
                if event.data:
                    try:
                        data = json.loads(event.data)
                        task_id = data.get("task_id")
                        if task_id and task_id in RESPONSE_QUEUE:
                            await RESPONSE_QUEUE[task_id].put(data)
                    except json.JSONDecodeError:
                        print(f"⚠️ Skipping non-JSON event: {event.data}")
        except Exception as e:
            print(f"🔁 SSE connection error: {e}, reconnecting in 5s...")
            await asyncio.sleep(5)

# === Handle User Input from Chat Interface ===
async def handle_user_input(user_input: str):
    response_text = await send_request(user_input)
    render_answer(response_text)

# === Main Entry Point ===
async def main():
    await asyncio.gather(
        run_chat_loop(handle_user_input, title=f"Slack {AGENT_NAME} Agent"),
        listen_for_events()
    )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Shutting down Slack MCP client.")
