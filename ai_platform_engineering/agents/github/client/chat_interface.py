"""
Chat interface for interacting with the GitHub agent.
"""

# SPDX-License-Identifier: Apache-2.0

import asyncio
import itertools
import json
import os
import re
import readline
import platform
from typing import Callable, Awaitable
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.theme import Theme

# Custom theme for GitHub-like appearance
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

async def spinner(msg: str = "⏳ Waiting for GitHub agent..."):
    for frame in itertools.cycle(['|', '/', '-', '\\']):
        print(f"\r{msg} {frame}", end='', flush=True)
        await asyncio.sleep(0.1)

def render_answer(answer: str):
    answer = answer.strip()
    if re.match(r"^b?[\"']?\{.*\}['\"]?$", answer):
        console.print("[warning]⚠️  Skipping raw byte/dict output.[/warning]")
        return
    
    console.print("\n")
    console.print(Panel(
        Markdown(answer),
        title="[github]GitHub Agent Response[/github]",
        border_style="github",
        padding=(1, 2)
    ))
    console.print("\n")

def clear_screen():
    """Clear the console screen based on the operating system."""
    if platform.system() == "Windows":
        os.system('cls')
    else:
        os.system('clear')

def print_welcome_message():
    console.print(Panel(
        "[github]🚀 Welcome to GitHub Agent CLI[/github]\n\n"
        "This agent helps you interact with GitHub repositories and manage your GitHub resources.\n"
        "You can ask questions about your repositories, manage issues, pull requests, and more.\n\n"
        "Type 'exit' or 'quit' to leave. Type 'clear' to clear the screen. Type 'history' to view chat history.",
        title="[github]GitHub Agent[/github]",
        border_style="github",
        padding=(1, 2)
    ))
    console.print("\n")

async def run_chat_loop(handle_user_input: Callable[[str], Awaitable[None]], title: str = "GitHub Agent"):
    print_welcome_message()
    history_file = os.path.expanduser("~/.github_agent_history")

    try:
        if os.path.exists(history_file):
            readline.read_history_file(history_file)
    except Exception as e:
        console.print(f"[warning]⚠️  Could not load history file: {e}[/warning]")

    try:
        while True:
            try:
                user_input = input("🧑‍💻 You: ").strip()
                if user_input.lower() in ["exit", "quit"]:
                    console.print("\n[github]👋 Thank you for using GitHub Agent. Goodbye![/github]")
                    break
                elif user_input.lower() == "clear":
                    clear_screen()
                    print_welcome_message()
                    continue
                elif user_input.lower() == "history":
                    console.print("\n[github]📜 Chat History (last 100 entries):[/github]")
                    history = [readline.get_history_item(i) for i in range(1, readline.get_current_history_length() + 1)]
                    for idx, entry in enumerate(history[-100:], 1):
                        console.print(f"{idx}: {entry}")
                    console.print()
                    continue
                if user_input:
                    readline.add_history(user_input)
                    spinner_task = asyncio.create_task(spinner())
                    try:
                        await handle_user_input(user_input)
                    except Exception as e:
                        console.print(f"[error]⚠️  An error occurred: {e}[/error]")
                    finally:
                        spinner_task.cancel()
                        try:
                            await spinner_task
                        except asyncio.CancelledError:
                            pass
            except (KeyboardInterrupt, EOFError):
                console.print("\n[github]👋 Chat interrupted. Goodbye![/github]")
                break
    finally:
        try:
            readline.write_history_file(history_file)
        except Exception as e:
            console.print(f"[warning]⚠️  Could not save history file: {e}[/warning]")

async def main():
    """Main chat loop."""
    if len(sys.argv) < 2:
        console.print("[error]Please provide the agent URL as an argument.[/error]")
        console.print("Example: python chat_interface.py http://localhost:8000")
        sys.exit(1)

    base_url = sys.argv[1]
    chat = ChatInterface(base_url)

    console.print("[github]Chat session started. Type 'exit' to quit.[/github]")
    console.print("[github]Enter your message:[/github]")

    await run_chat_loop(lambda message: chat.send_message(message), title="GitHub Agent")

    await chat.client.aclose()
    console.print("[github]Chat session ended.[/github]")

if __name__ == "__main__":
    import sys
    asyncio.run(main())
