# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

import asyncio
import itertools
import logging
import click
from typing import Dict, List, Optional

from .langgraph import AGENT_GRAPH
from .state import AgentState, ConfigSchema, InputState, Message, MsgType

logger = logging.getLogger(__name__)

class ParamMessage:
    """Parameter message class."""
    def __init__(self, value: str):
        self.value = value

    def __str__(self) -> str:
        return self.value

def run_pagerduty_agent(
    human_messages: List[str],
    assistant_messages: Optional[List[str]] = None,
) -> None:
    """Run the PagerDuty agent."""
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    
    # Process messages
    messages = []
    for human_msg, assistant_msg in itertools.zip_longest(
        human_messages,
        assistant_messages or [],
        fillvalue=None
    ):
        messages.append(Message(type=MsgType.HUMAN, content=human_msg))
        if assistant_msg:
            messages.append(Message(type=MsgType.ASSISTANT, content=assistant_msg))
    
    # Prepare agent input
    agent_input = InputState(messages=messages)
    
    # Run the agent
    result = AGENT_GRAPH.invoke(agent_input)
    
    # Print output messages
    for msg in result.messages:
        print(msg.content)

@click.command()
@click.option(
    "--human-messages",
    "-h",
    multiple=True,
    help="Human messages to send to the agent",
)
@click.option(
    "--assistant-messages",
    "-a",
    multiple=True,
    help="Assistant messages to send to the agent",
)
def main(
    human_messages: List[str],
    assistant_messages: Optional[List[str]] = None,
) -> None:
    """Run the PagerDuty agent."""
    run_pagerduty_agent(human_messages, assistant_messages)

if __name__ == "__main__":
    main() 