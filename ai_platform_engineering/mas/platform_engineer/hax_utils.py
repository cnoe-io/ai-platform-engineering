# Copyright 2025 Cisco Systems, Inc. and its affiliates
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0


import uuid
import json
from typing import List, Dict, Any

from langchain_core.messages import (
    HumanMessage,
    SystemMessage,
    AIMessage,
    BaseMessage,
    ToolMessage,
)


def langchain_to_hax(messages: List[BaseMessage]) -> List[Dict[str, Any]]:
    """
    Convert LangChain messages to HAX format.

    The HAX format splits tool calls into separate messages and maintains
    parent/child relationships between messages.
    """
    import logging

    logger = logging.getLogger("corto.supervisor.graph")

    logger.info(f"Converting messages: {[type(m).__name__ for m in messages]}")
    result = []
    tool_call_names = {}  # Track tool names by ID

    # First pass: collect tool call names for reference
    for message in messages:
        if isinstance(message, AIMessage):
            for tool_call in message.tool_calls or []:
                tool_call_names[tool_call["id"]] = tool_call["name"]

    # Second pass: convert messages
    for message in messages:
        content = message.content
        message_id = getattr(message, "id", str(uuid.uuid4()))

        if isinstance(message, HumanMessage):
            result.append(
                {
                    "type": "TextMessage",
                    "role": "user",
                    "content": content,
                    "id": message_id,
                }
            )
        elif isinstance(message, SystemMessage):
            result.append(
                {
                    "type": "TextMessage",
                    "role": "system",
                    "content": content,
                    "id": message_id,
                }
            )
        elif isinstance(message, AIMessage):
            # Add AI response message
            if content:
                result.append(
                    {
                        "type": "TextMessage",
                        "role": "assistant",
                        "content": content,
                        "id": message_id,
                    }
                )

            # Add separate messages for each tool call
            for tool_call in message.tool_calls or []:
                action_id = tool_call.get("id", str(uuid.uuid4()))
                result.append(
                    {
                        "type": "ActionExecutionMessage",
                        "id": action_id,
                        "parentMessageId": message_id,
                        "name": tool_call["name"],
                        "arguments": tool_call["args"],
                    }
                )
        elif isinstance(message, ToolMessage):
            logger.info(f"Processing ToolMessage: {message}")
            tool_result = {
                "type": "ResultMessage",
                "id": message_id,
                "actionName": tool_call_names.get(
                    message.tool_call_id, message.name or ""
                ),
                "actionExecutionId": message.tool_call_id,
                "result": content,
            }
            logger.info(f"Created tool result message: {tool_result}")
            result.append(tool_result)

    return result


def hax_to_langchain(
    messages: List[Dict[str, Any]], use_function_call: bool = False
) -> List[BaseMessage]:
    """
    Convert HAX messages to LangChain format.

    Args:
        messages: List of CopilotKit messages
        use_function_call: If True, uses function_call format instead of tool_calls
    """
    result = []
    processed_action_executions = set()

    for message in messages:
        if message["type"] == "TextMessage":
            if message["role"] == "user":
                result.append(
                    HumanMessage(content=message["content"], id=message["id"])
                )
            elif message["role"] == "system":
                result.append(
                    SystemMessage(content=message["content"], id=message["id"])
                )
            elif message["role"] == "assistant":
                result.append(AIMessage(content=message["content"], id=message["id"]))

        elif message["type"] == "ActionExecutionMessage":
            if use_function_call:
                result.append(
                    AIMessage(
                        id=message["id"],
                        content="",
                        additional_kwargs={
                            "function_call": {
                                "name": message["name"],
                                "arguments": json.dumps(message["arguments"]),
                            }
                        },
                    )
                )
            else:
                # Group tool calls by parent message
                message_id = message.get("parentMessageId", message["id"])
                if message_id in processed_action_executions:
                    continue

                processed_action_executions.add(message_id)
                tool_calls = []

                # Find all tool calls for this parent message
                for msg in messages:
                    if msg.get("type") == "ActionExecutionMessage" and (
                        msg.get("parentMessageId") == message_id
                        or msg["id"] == message_id
                    ):
                        tool_calls.append(
                            {
                                "id": msg["id"],
                                "name": msg["name"],
                                "args": msg["arguments"],
                            }
                        )

                result.append(
                    AIMessage(id=message_id, content="", tool_calls=tool_calls)
                )

        elif message["type"] == "ResultMessage":
            result.append(
                ToolMessage(
                    id=message["id"],
                    content=message["result"],
                    name=message["actionName"],
                    tool_call_id=message["actionExecutionId"],
                )
            )

    return result
