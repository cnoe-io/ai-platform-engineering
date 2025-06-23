# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import logging
import uuid
import json

from langchain_core.messages import AIMessage
from langchain_core.tools import BaseTool
from langgraph.graph.state import CompiledStateGraph
from langgraph_supervisor import create_supervisor
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from typing import List, Dict, Any

from cnoe_agent_utils import LLMFactory

from ai_platform_engineering.mas.platform_engineer.prompts import (
    system_prompt,
    response_format_instruction,
)
from ai_platform_engineering.mas.platform_engineer.models import Action

from ai_platform_engineering.agents.argocd.agent import argocd_agent
from ai_platform_engineering.agents.atlassian.agent import atlassian_agent
from ai_platform_engineering.agents.pagerduty.agent import pagerduty_agent
from ai_platform_engineering.agents.github.agent import github_agent
from ai_platform_engineering.agents.slack.agent import slack_agent
import os

from ai_platform_engineering.utils.models.generic_agent import ResponseFormat

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class DynamicTool(BaseTool):
    """Dynamically created tool from a HAX Action"""

    action: Action = None
    schema: Dict = None

    def __init__(self, action: Action):
        schema = json.loads(action.jsonSchema)
        logger.info(f"Tool schema for {action.name}: {schema}")
        super().__init__(
            name=action.name,
            description=action.description,
            args_schema=schema,
            return_direct=False,
        )
        self.action = action
        self.schema = schema

    def _run(self, **kwargs):
        """Execute the tool and return its result."""
        logger.info(f"DynamicTool {self.name} executing with args: {kwargs}")
        tool_result = json.dumps(kwargs)  # Return raw args as JSON for tool message
        logger.info(f"DynamicTool {self.name} produced result: {tool_result}")
        return tool_result

    def _return_direct(self) -> bool:
        logger.info(f"Checking return_direct for {self.name}")
        return False

    async def _arun(self, **kwargs):
        return self._run(**kwargs)


class AIPlatformEngineerMAS:
    def __init__(self):
        self.graph = self.build_graph()

    def convert_actions_to_tools(self, actions: List[Action]) -> List[BaseTool]:
        """Convert Action objects to LangChain tools"""
        if not actions:
            logger.info("No actions to convert to tools")
            return []
        logger.info(
            f"Converting {len(actions)} actions to tools: {[a.name for a in actions]}"
        )
        tools = [DynamicTool(action) for action in actions]
        logger.info(f"Created tools: {[t.name for t in tools]}")
        return tools

    def get_graph(self) -> CompiledStateGraph:
        """
        Returns the compiled LangGraph instance for the AI Platform Engineer MAS.

        This method initializes the graph if it has not been created yet and returns
        the compiled graph instance.

        Returns:
            CompiledStateGraph: The compiled LangGraph instance.
        """
        if not hasattr(self, "graph"):
            self.graph = self.build_graph()
        return self.graph

    def build_graph(self, additional_tools=None) -> CompiledStateGraph:
        """
        Constructs and compiles a LangGraph instance.

        Args:
            additional_tools (List[BaseTool], optional): Additional tools to add to the supervisor agent.

        This function initializes a `SupervisorAgent` to create the base graph structure
        and uses an `InMemorySaver` as the checkpointer for the compilation process.

    # Check if LANGGRAPH_DEV is defined in the environment
    if os.getenv("LANGGRAPH_DEV"):
      checkpointer = None
      store = None
    else:
      checkpointer = InMemorySaver()
      store = InMemoryStore()

        Returns:
        CompiledGraph: A fully compiled LangGraph instance ready for execution.
        """
        model = LLMFactory().get_llm()

        checkpointer = InMemorySaver()
        store = InMemoryStore()

        # Create a list of tools, including any additional tools if provided
        tools = additional_tools if additional_tools else []

        graph = create_supervisor(
            model=model,
            agents=[
                argocd_agent,
                atlassian_agent,
                pagerduty_agent,
                github_agent,
                slack_agent,
                # Add other agents here as needed
            ],
            tools=tools,
            prompt=system_prompt,
            add_handoff_back_messages=True,
            output_mode="full_history",
            response_format=(response_format_instruction, ResponseFormat),
        ).compile(
            checkpointer=checkpointer,
            store=store,
        )
        logger.debug("LangGraph supervisor created and compiled successfully.")
        return graph

    async def serve(self, prompt: str, actions: List[Action] = None) -> str:
        """
        Processes the input prompt and returns a response from the graph.
        Args:
            prompt (str): The input prompt to be processed by the graph.
        Returns:
            str: The response generated by the graph based on the input prompt.
        """
        try:
            logger.debug(f"Received prompt: {prompt}")
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError("Prompt must be a non-empty string.")

            # Convert actions to tools and rebuild graph if needed
            additional_tools = (
                self.convert_actions_to_tools(actions) if actions else None
            )
            if additional_tools or self.graph is None:
                self.graph = self.build_graph(additional_tools)

            result = await self.graph.ainvoke(
                {
                    "messages": [{"role": "user", "content": prompt}],
                },
                {"configurable": {"thread_id": uuid.uuid4()}},
            )

            messages = result.get("messages", [])
            if not messages:
                raise RuntimeError("No messages found in the graph response.")

            # Find the last AIMessage with non-empty content
            for message in reversed(messages):
                if isinstance(message, AIMessage) and message.content.strip():
                    logger.debug(f"Valid AIMessage found: {message.content.strip()}")
                    return message.content.strip()

            raise RuntimeError("No valid AIMessage found in the graph response.")
        except ValueError as ve:
            logger.error(f"ValueError in serve method: {ve}")
            raise ValueError(str(ve))
        except Exception as e:
            logger.error(f"Error in serve method: {e}")
            raise Exception(str(e))

    async def full_serve(
        self,
        messages: List[Dict[str, Any]],
        actions: List[Action] = None,
        thread_id: str = None,
    ):
        """
        Processes the input prompt and returns a response from the graph.
        Args:
            messages (List[AnyMessage]): The input messages to be processed by the graph.
            actions (List[Action], optional): A list of Action objects that can be converted to tools.
        Returns:
            str: The response generated by the graph based on the input messages.
        """
        try:
            from .hax_utils import hax_to_langchain

            langchain_messages = hax_to_langchain(messages)

            logger.debug(f"Received messages: {messages}")
            if not langchain_messages or not isinstance(langchain_messages, list):
                raise ValueError(
                    "Messages must be a non-empty list of LangChain messages."
                )

            # Convert actions to tools and rebuild graph if needed
            additional_tools = (
                self.convert_actions_to_tools(actions) if actions else None
            )
            if additional_tools or self.graph is None:
                self.graph = self.build_graph(additional_tools)

            # Create initial messages state with proper message sequence
            initial_state = {"messages": langchain_messages}

            # Invoke the graph with proper configuration for message handling
            result = await self.graph.ainvoke(
                initial_state,
                {
                    "configurable": {
                        "thread_id": thread_id or str(uuid.uuid4()),
                    },
                    "metadata": {
                        "hax:emit-messages": True,
                        "hax:emit-tool-calls": True,
                    },
                },
            )

            # Get and validate messages
            messages = result.get("messages", [])
            if not messages:
                raise RuntimeError("No messages found in the graph response.")

            from .hax_utils import langchain_to_hax

            logger.info("Converting messages to hax format...")

            hax_messages = langchain_to_hax(messages)
            return hax_messages
        except ValueError as ve:
            logger.error(f"ValueError in serve method: {ve}")
            raise ValueError(str(ve))
        except Exception as e:
            logger.error(f"Error in serve method: {e}")
            raise Exception(str(e))
