# SPDX-License-Identifier: Apache-2.0

import json
import sys
import os
import asyncio
import uuid
import readline
from typing import Dict, Any, Callable, Awaitable
from rich.console import Console
from rich.panel import Panel
from rich.theme import Theme
from httpx_sse import ServerSentEvent
from agntcy_acp import AsyncACPClient, ApiClientConfiguration
from agntcy_acp.acp_v0.async_client.api_client import ApiClient as AsyncApiClient
from agntcy_acp.models import RunCreateStateless, RunResult, RunError, Config
from dotenv import load_dotenv

# Custom theme for better GitHub-like appearance
custom_theme = Theme({
    "info": "cyan",
    "warning": "yellow",
    "error": "red",
    "success": "green",
    "github": "#2DA44E",
    "github.dark": "#238636",
    "github.light": "#3FB950"
})

console = Console(theme=custom_theme)

def check_environment():
    """Check required environment variables."""
    required_vars = [
        "CNOE_AGENT_GITHUB_PORT",
        "CNOE_AGENT_GITHUB_API_KEY",
        "CNOE_AGENT_GITHUB_ID",
        "GITHUB_PERSONAL_ACCESS_TOKEN"
    ]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    
    if missing_vars:
        console.print(Panel(
            f"[error]Missing required environment variables:[/error]\n" + 
            "\n".join(f"  - {var}" for var in missing_vars),
            title="[error]Environment Error[/error]",
            border_style="error"
        ))
        return False
    
    # Check for newlines in API_KEY
    api_key = os.getenv("CNOE_AGENT_GITHUB_API_KEY", "")
    if "\n" in api_key or "\r" in api_key:
        console.print(Panel(
            "[warning]CNOE_AGENT_GITHUB_API_KEY contains newlines. This may cause issues.[/warning]",
            title="[warning]Warning[/warning]",
            border_style="warning"
        ))
        return False
    
    return True

# Host can't have trailing slash
WFSM_PORT = os.getenv("CNOE_AGENT_GITHUB_PORT", "").strip()
API_KEY = os.getenv("CNOE_AGENT_GITHUB_API_KEY", "").strip()

if not WFSM_PORT or not API_KEY:
    raise EnvironmentError("CNOE_AGENT_GITHUB_PORT and CNOE_AGENT_GITHUB_API_KEY environment variables must be set")

client_config = ApiClientConfiguration(
    host=f"http://localhost:{WFSM_PORT}",
    api_key={"x-api-key": API_KEY},
    retries=3
)

async def run_stateless(question: str, process_event: Callable[[ServerSentEvent], Awaitable[None]]):
    """
    Create a stateless run with the input spec and stream the output.
    Calls process_event(event) for each streamed event.
    """
    try:
        async with AsyncApiClient(client_config) as api_client:
            acp_client = AsyncACPClient(api_client)
            agent_id = os.getenv("CNOE_AGENT_GITHUB_ID", "").strip()
            if not agent_id:
                raise EnvironmentError("CNOE_AGENT_GITHUB_ID environment variable is not set")

            # Print debug info about GitHub token before use
            github_token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN", "")
            if not github_token:
                console.print("[warning]Warning: GITHUB_PERSONAL_ACCESS_TOKEN is empty[/warning]")
            else:
                console.print(f"[info]Using GitHub token starting with: {github_token[:10]}...[/info]")

            # Compose input for GitHub agent with environment variables
            input_obj = {
                "github_input": {
                    "messages": [
                        {
                            "type": "human",
                            "content": question
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
                console.print("[info]Sending request to ACP client...[/info]")
                run_output = await acp_client.create_and_wait_for_stateless_run_output(run_create)
                console.print("[success]Received response from ACP client[/success]")
            except Exception as e:
                console.print(Panel(
                    f"[error]Error communicating with server: {str(e)}[/error]\n"
                    "Please ensure the server is running and accessible",
                    title="[error]Server Error[/error]",
                    border_style="error"
                ))
                return

            if run_output.output is None:
                console.print("[error]Error: Run output is None[/error]")
                return

            actual_output = run_output.output.actual_instance
            if isinstance(actual_output, RunResult):
                run_result: RunResult = actual_output
            elif isinstance(actual_output, RunError):
                run_error: RunError = actual_output
                console.print(Panel(
                    f"[error]Run Failed: {run_error}[/error]",
                    title="[error]Run Error[/error]",
                    border_style="error"
                ))
                return
            else:
                console.print(f"[error]Unexpected response type: {type(actual_output)}[/error]")
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
                console.print("[warning]No response messages found in output[/warning]")
                console.print(f"[info]Run state keys: {run_state.keys()}[/info]")

    except Exception as e:
        console.print(Panel(
            f"[error]An error occurred: {str(e)}[/error]",
            title="[error]Error[/error]",
            border_style="error"
        ))
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    if not check_environment():
        sys.exit(1)

    async def process_event(event):
        event_data = json.loads(event.data)
        answer = event_data.get("answer", "No answer found")
        console.print(f"[github]Agent: {answer}[/github]")

    async def chat_interface():
        console.print("[github]Start chatting with the GitHub agent. Press Ctrl+C to exit.[/github]")
        history_file = os.path.expanduser("~/.github_agent_history")
        try:
            if os.path.exists(history_file):
                readline.read_history_file(history_file)
        except Exception as e:
            console.print(f"[warning]Could not load history file: {e}[/warning]")

        try:
            while True:
                try:
                    user_input = input("\n> Your Question: ")
                    if user_input.strip().lower() in ["exit", "quit"]:
                        console.print("[github]Exiting chat.[/github]")
                        break
                    if user_input.strip():
                        readline.add_history(user_input)
                    await run_stateless(user_input, process_event)
                except KeyboardInterrupt:
                    console.print("\n[github]Exiting chat.[/github]")
                    break
        finally:
            try:
                readline.write_history_file(history_file)
            except Exception as e:
                console.print(f"[warning]Could not save history file: {e}[/warning]")

    asyncio.run(chat_interface())