"""
Chat interface for interacting with the PagerDuty agent.
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

console = Console()

async def spinner(msg: str = "⏳ Waiting for response..."):
    for frame in itertools.cycle(['|', '/', '-', '\\']):
        print(f"\r{msg} {frame}", end='', flush=True)
        await asyncio.sleep(0.1)

def render_answer(answer: str):
    answer = answer.strip()
    if re.match(r"^b?[\"']?\{.*\}['\"]?$", answer):
        print("⚠️  Skipping raw byte/dict output.")
        return
    console.print("\n")
    console.print(Markdown("**Answer:**"))
    if answer:
        console.print(Markdown(answer))
    else:
        console.print("[italic]🤷 No answer returned.[/italic]")
    console.print("\n\n")

def clear_screen():
    """Clear the console screen based on the operating system."""
    if platform.system() == "Windows":
        os.system('cls')
    else:
        os.system('clear')

async def run_chat_loop(handle_user_input: Callable[[str], Awaitable[None]], title: str = "Agentic AI"):
    print(f"🚀 Start chatting with your {title}...\n💬 Type your question and hit enter. Type 'exit' or 'quit' to leave. Type 'clear' to clear the screen.\n")
    history_file = os.path.expanduser("~/.chat_history")

    try:
        if os.path.exists(history_file):
            readline.read_history_file(history_file)
    except Exception as e:
        print(f"⚠️  Could not load history file: {e}")

    try:
        while True:
            try:
                user_input = input("🧑‍💻 You: ").strip()
                if user_input.lower() in ["exit", "quit"]:
                    print("\n👋 Exiting chat. See you next time!")
                    break
                elif user_input.lower() == "clear":
                    clear_screen()
                    print(f"🚀 Start chatting with your {title}...\n💬 Type your question and hit enter. Type 'exit' or 'quit' to leave. Type 'clear' to clear the screen.\n")
                    continue
                if user_input:
                    readline.add_history(user_input)
                    spinner_task = asyncio.create_task(spinner())
                    try:
                        await handle_user_input(user_input)
                    except Exception as e:
                        print(f"⚠️  An error occurred while processing your input: {e}")
                    finally:
                        spinner_task.cancel()
                        try:
                            await spinner_task
                        except asyncio.CancelledError:
                            pass
            except KeyboardInterrupt:
                print("\n👋 Chat interrupted. Goodbye!")
                break
    finally:
        try:
            readline.write_history_file(history_file)
        except Exception as e:
            print(f"⚠️  Could not save history file: {e}")

async def main():
    """Main chat loop."""
    if len(sys.argv) < 2:
        console.print("[red]Please provide the agent URL as an argument.[/red]")
        console.print("Example: python chat_interface.py http://localhost:8000")
        sys.exit(1)

    base_url = sys.argv[1]
    chat = ChatInterface(base_url)

    console.print("[green]Chat session started. Type 'exit' to quit.[/green]")
    console.print("[green]Enter your message:[/green]")

    await run_chat_loop(lambda message: chat.send_message(message))

    await chat.client.aclose()
    console.print("[green]Chat session ended.[/green]")

if __name__ == "__main__":
    asyncio.run(main()) 