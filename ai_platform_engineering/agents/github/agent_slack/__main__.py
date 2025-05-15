# SPDX-License-Identifier: Apache-2.0
import asyncio
import itertools
import logging
import click
from langchain_core.runnables import RunnableConfig

# Change these imports to reference your slack MCP modules
from .langgraph import SLACK_GRAPH
from .state import AgentState, ConfigSchema, InputState, Message, MsgType

logger = logging.getLogger(__name__)

class ParamMessage(click.ParamType):
    name = "message"

    def __init__(self, **kwargs):
        self.msg_type = kwargs.pop("msg_type", MsgType.human)
        super().__init__(**kwargs)

    def convert(self, value, param, ctx):
        try:
            return Message(type=self.msg_type, content=value)
        except ValueError:
            self.fail(f"{value!r} is not valid message content", param, ctx)


@click.command(short_help="Run Slack Agent")
@click.option(
    "--log-level",
    type=click.Choice(["critical", "error", "warning", "info", "debug"], case_sensitive=False),
    default="info",
    help="Set logging level.",
)
@click.option(
    "--human",
    type=ParamMessage(msg_type=MsgType.human),
    multiple=True,
    help="Add human message(s).",
)
@click.option(
    "--assistant",
    type=ParamMessage(msg_type=MsgType.assistant),
    multiple=True,
    help="Add assistant message(s).",
)
def run_slack_agent(log_level, human, assistant):
    logging.basicConfig(level=log_level.upper())
    config = ConfigSchema()

    # Combine messages in natural order
    if human and assistant:
        messages = list(itertools.chain(*zip(human, assistant)))
        messages += human[len(assistant):] if len(human) > len(assistant) else assistant[len(human):]
    elif human:
        messages = list(human)
    elif assistant:
        messages = list(assistant)
    else:
        messages = []

    # Changed to slack_input instead of argocd_input
    state_input = InputState(messages=messages)
    logger.debug(f"input messages: {state_input.model_dump_json()}")

    # Prepare graph input - changed to slack_input
    agent_input = AgentState(slack_input=state_input).model_dump(mode="json")

    # Use SLACK_GRAPH instead of AGENT_GRAPH
    result = SLACK_GRAPH.invoke(
        SLACK_GRAPH.builder.schema.model_validate(agent_input),
        config=RunnableConfig(configurable=config),
    )

    logger.debug(f"output messages: {result}")
    # Changed to slack_output
    print(result["slack_output"].model_dump_json(indent=2))


if __name__ == "__main__":
    run_slack_agent()  # type: ignore