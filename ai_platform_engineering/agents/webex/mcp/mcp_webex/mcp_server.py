# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
from enum import Enum
from typing import Annotated

import httpx
from mcp.server import Server
from mcp.shared.exceptions import McpError
from mcp.types import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    CallToolResult,
    ErrorData,
    TextContent,
    Tool,
)
from pydantic import BaseModel, Field, model_validator

try:
    from .__about__ import __version__
except ImportError:
    from mcp_webex.__about__ import __version__

WEBEX_API_BASE = "https://webexapis.com/v1"


class PostMessage(BaseModel):
    text: Annotated[str, Field(description="Text message to send")]
    to_person_email: Annotated[
        str | None,
        Field(description="Email of the person to send the message to",
              default=None),
    ]
    markdown: Annotated[
        str | None, Field(description="Markdown message to send", default=None)]
    room_id: Annotated[
        str | None,
        Field(description="Room that will receive the message", default=None),
    ]
    parent_id: Annotated[
        str | None,
        Field(
            description="If specified, this message is a reply in a thread ("
                        "parentId)",
            default=None,
        ),
    ]

    class Config:
        description = "Message to be sent to the Webex room"

    @model_validator(mode="before")
    def validate_message_content(cls, data):
        if not (data.get("text") or data.get("markdown")):
            raise ValueError("Either 'text' or 'markdown' must be provided")

        if not (data.get("room_id") or data.get("to_person_email")):
            raise ValueError(
                "Either 'room_id' or 'to_person_email' must be provided")

        return data


class CreateRoom(BaseModel):
    title: str = Field(description="Title of the Webex room to create")

    class Config:
        description = "Request to create a new Webex room"


class AddUsersToRoom(BaseModel):
    room_id: str = Field(description="ID of the Webex room to add users to")
    user_emails: list[str] = Field(
        description="List of email addresses of users to add to the room")

    class Config:
        description = "Add multiple users to an existing Webex room"
        json_schema_extra = {
            "required": ["room_id", "user_emails"],
        }


class ListDirectMessages(BaseModel):
    person_email: str = Field(
        description="Email address of the person whose messages to retrieve")
    max_results: int | None = Field(default=50,
                                    description="Maximum number of messages "
                                                "to return")

    class Config:
        description = "List messages exchanged with a person"


class ListMessagesInRoom(BaseModel):
    room_id: str = Field(
        description="ID of the Webex room whose messages to retrieve")
    max: int | None = Field(default=None,
                            description="Maximum number of messages to return")
    parent_id: str | None = Field(
        default=None,
        description="If specified, only list messages with this parentId ("
                    "thread)",
    )

    class Config:
        description = "List messages in a Webex room"


class ListRooms(BaseModel):
    max: int | None = Field(default=None,
                            description="Maximum number of rooms to return")
    team_id: str | None = Field(default=None,
                                description="If specified, only list rooms "
                                            "for this team")

    class Config:
        description = "List Webex rooms"


class ListUsersInRoom(BaseModel):
    room_id: str = Field(description="ID of the Webex room whose users to list")
    max: int | None = Field(default=None,
                            description="Maximum number of users to return")

    class Config:
        description = "List users in a Webex room"


class ListThreadMessages(BaseModel):
    room_id: str = Field(
        description="ID of the Webex room containing the thread")
    parent_id: str = Field(description="ID of the parent message (thread)")
    max: int | None = Field(default=None,
                            description="Maximum number of messages to return")

    class Config:
        description = "List messages in a thread in a Webex room"


class WebexTools(str, Enum):
    POST_MESSAGE = "post_message"
    CREATE_ROOM = "create_room"
    ADD_USERS_TO_ROOM = "add_users_to_room"
    LIST_DIRECT_MESSAGES = "list_direct_messages"
    LIST_MESSAGES_IN_ROOM = "list_messages_in_room"
    LIST_ROOMS = "list_rooms"
    LIST_USERS_IN_ROOM = "list_users_in_room"
    LIST_THREAD_MESSAGES = "list_thread_messages"


async def serve(auth_token: str) -> Server:
    logger = logging.getLogger(__name__)

    server = Server("mcp-webex", __version__)
    http_client = httpx.AsyncClient(base_url=WEBEX_API_BASE)

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [
            Tool(
                name=WebexTools.POST_MESSAGE,
                description="""Post a new message to a Webex room or to a user.
            Use this tool when you need to send a message to a Webex room or
            directly to a user.
            When sending a message to a user, you can specify the user's
            email address.
            You can also send the message in markdown format.
            You can use this to reply to a thread in adding the parentId of a
            previous message.
            User this tool for example when you need to inform, signal the
            user about something or you want to reassure something.""",
                inputSchema=PostMessage.model_json_schema(),
            ),
            Tool(
                name=WebexTools.CREATE_ROOM,
                description="""Create a new Webex room.
            Use this tool when you need to create a new Webex room for a
            conversation or project.""",
                inputSchema=CreateRoom.model_json_schema(),
            ),
            Tool(
                name=WebexTools.ADD_USERS_TO_ROOM,
                description="""Add multiple users to an existing Webex room.
            Use this tool when you need to add several users to a room at
            once.""",
                inputSchema=AddUsersToRoom.model_json_schema(),
            ),
            Tool(
                name=WebexTools.LIST_DIRECT_MESSAGES,
                description="""List messages exchanged with a specific person.
        Use this tool when you need to retrieve conversation history with a
        person.""",
                inputSchema=ListDirectMessages.model_json_schema(),
            ),
            Tool(
                name=WebexTools.LIST_MESSAGES_IN_ROOM,
                description="""List messages in a Webex room.
        Use this tool when you need to retrieve messages from a specific room,
        these can only contain messages in which you as agent are mentioned.""",
                inputSchema=ListMessagesInRoom.model_json_schema(),
            ),
            Tool(
                name=WebexTools.LIST_ROOMS,
                description="""List Webex rooms. Use this tool to retrieve a
                list of rooms you are a member of. You can optionally filter
                by team or limit the number of results.""",
                inputSchema=ListRooms.model_json_schema(),
            ),
            Tool(
                name=WebexTools.LIST_USERS_IN_ROOM,
                description="""List users in a Webex room. Use this tool to
                retrieve the list of users (members) in a specific Webex
                room.""",
                inputSchema=ListUsersInRoom.model_json_schema(),
            ),
            Tool(
                name=WebexTools.LIST_THREAD_MESSAGES,
                description="""List messages in a thread in a Webex room. Use
                this tool to retrieve all messages that are replies to a
                specific
                parent message (thread) in a room.""",
                inputSchema=ListThreadMessages.model_json_schema(),
            ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> (list[
                                                            TextContent] |
                                                        CallToolResult):
        logger.debug(f"Calling tool {name} with {arguments}")
        try:
            match name:
                case WebexTools.POST_MESSAGE:
                    post_message = PostMessage(**arguments)
                    logger.debug("Post message: %s", post_message)
                    payload = {
                        "text": post_message.text,
                        "markdown": post_message.markdown,
                        "roomId": post_message.room_id,
                        "toPersonEmail": post_message.to_person_email,
                        "parentId": post_message.parent_id,
                    }
                    logger.debug("Post message payload: %s", payload)

                    response = await http_client.post(
                        "/messages",
                        headers={"Authorization": f"Bearer {auth_token}"},
                        json={k: v for k, v in payload.items() if
                              v is not None},
                    )
                    response.raise_for_status()
                    logger.debug("POST response: %s", response.json())
                    return [TextContent(type="text",
                                        text="Message sent successfully")]

                case WebexTools.CREATE_ROOM:
                    create_room = CreateRoom(**arguments)
                    logger.debug("Create room: %s", create_room)
                    payload = {"title": create_room.title}

                    response = await http_client.post(
                        "/rooms",
                        headers={"Authorization": f"Bearer {auth_token}"},
                        json=payload,
                    )
                    response.raise_for_status()
                    room = response.json()
                    return [
                        TextContent(
                            type="text",
                            text=f"Room created successfully: "
                                 f"{room.get('title')} (ID: {room.get('id')})",
                        )
                    ]

                case WebexTools.ADD_USERS_TO_ROOM:
                    add_users = AddUsersToRoom(**arguments)
                    logger.debug("Adding users to room: %s", add_users)

                    # Error handling for empty room_id or user_emails
                    if not (add_users.room_id and add_users.user_emails):
                        return CallToolResult(
                            isError=True,
                            content=[
                                TextContent(
                                    type="text",
                                    text="Error: 'room_id' and 'user_emails' "
                                         "must not be empty.",
                                )
                            ],
                        )

                    results = []
                    for email in add_users.user_emails:
                        membership_payload = {
                            "roomId": add_users.room_id,
                            "personEmail": email,
                        }
                        try:
                            response = await http_client.post(
                                "/memberships",
                                headers={
                                    "Authorization": f"Bearer {auth_token}"},
                                json=membership_payload,
                            )
                            response.raise_for_status()
                            results.append(f"Added {email} successfully")
                        except httpx.HTTPStatusError as e:
                            error_message = (f"Failed to add {email}: "
                                             f"{e.response.text}")
                            logger.error(error_message)
                            results.append(error_message)

                    return [TextContent(type="text",
                                        text="Results:\n" + "\n".join(results))]

                case WebexTools.LIST_DIRECT_MESSAGES:
                    list_messages = ListDirectMessages(**arguments)
                    logger.debug("List messages: %s", list_messages)

                    if not list_messages.person_email:
                        return CallToolResult(
                            isError=True,
                            content=[
                                TextContent(
                                    type="text",
                                    text="Error: 'person_email' must not be "
                                         "empty.",
                                )
                            ],
                        )

                    query_params = {
                        "personEmail": list_messages.person_email,
                        "max": list_messages.max_results,
                    }

                    response = await http_client.get(
                        "/messages",
                        headers={"Authorization": f"Bearer {auth_token}"},
                        params=query_params,
                    )
                    response.raise_for_status()
                    messages_data = response.json()
                    logger.debug("Response body: %s", messages_data)

                    messages = messages_data.get("items", [])
                    if not messages:
                        return [TextContent(type="text",
                                            text="No messages found with this "
                                                 "person")]

                    results = []
                    for message in messages:
                        sender = message.get("personEmail", "Unknown")
                        created = message.get("created", "Unknown time")
                        text = message.get("text", "(No text content)")
                        results.append(
                            f"From: {sender}\nTime: {created}\nMessage: {
                            text}\n")

                    return [
                        TextContent(
                            type="text",
                            text=f"Found {len(messages)} messages with "
                                 f"{list_messages.person_email}:\n\n" +
                                 "\n".join(
                                     results),
                        )
                    ]

                case WebexTools.LIST_MESSAGES_IN_ROOM:
                    list_messages = ListMessagesInRoom(**arguments)
                    logger.debug("List messages in room: %s", list_messages)

                    params = {"roomId": list_messages.room_id,
                              "mentionedPeople": "me"}
                    if list_messages.max is not None:
                        params["max"] = str(list_messages.max)
                    if list_messages.parent_id is not None:
                        params["parentId"] = list_messages.parent_id

                    response = await http_client.get(
                        "/messages",
                        headers={"Authorization": f"Bearer {auth_token}"},
                        params=params,
                    )
                    response.raise_for_status()
                    messages = response.json().get("items", [])
                    formatted = "\n".join([
                        f"[{m.get('created')}] "
                        f"{m.get('personEmail')}: "
                        f"{m.get('text', '')}"
                        for m in messages])
                    return [TextContent(type="text",
                                        text=formatted or "No messages found.")]

                case WebexTools.LIST_ROOMS:
                    list_rooms = ListRooms(**arguments)
                    logger.debug("List rooms: %s", list_rooms)

                    params = {}
                    if list_rooms.max is not None:
                        params["max"] = list_rooms.max
                    if list_rooms.team_id is not None:
                        params["teamId"] = list_rooms.team_id

                    response = await http_client.get(
                        "/rooms",
                        headers={"Authorization": f"Bearer {auth_token}"},
                        params=params,
                    )
                    response.raise_for_status()
                    rooms = response.json().get("items", [])
                    formatted = "\n".join(
                        [f"{r.get('title')} (ID: {r.get('id')})" for r in
                         rooms])
                    return [TextContent(type="text",
                                        text=formatted or "No rooms found.")]

                case WebexTools.LIST_USERS_IN_ROOM:
                    list_users = ListUsersInRoom(**arguments)
                    logger.debug("List users in room: %s", list_users)
                    params = {"roomId": list_users.room_id}
                    if list_users.max is not None:
                        params["max"] = str(list_users.max)
                    response = await http_client.get(
                        "/memberships",
                        headers={"Authorization": f"Bearer {auth_token}"},
                        params=params,
                    )
                    response.raise_for_status()
                    memberships = response.json().get("items", [])
                    if not memberships:
                        return [TextContent(type="text",
                                            text="No users found in this "
                                                 "room.")]
                    formatted = "\n".join([
                        f"{m.get('personEmail', 'Unknown')} (ID: {m.get('id',
                                                                        'N/A')})"
                        for m in memberships])
                    return [TextContent(type="text", text=formatted)]

                case WebexTools.LIST_THREAD_MESSAGES:
                    thread_args = ListThreadMessages(**arguments)
                    logger.debug("List messages in thread: %s", thread_args)
                    params = {
                        "roomId": thread_args.room_id,
                        "parentId": thread_args.parent_id,
                    }
                    if thread_args.max is not None:
                        params["max"] = str(thread_args.max)
                    response = await http_client.get(
                        "/messages",
                        headers={"Authorization": f"Bearer {auth_token}"},
                        params=params,
                    )
                    response.raise_for_status()
                    messages = response.json().get("items", [])
                    if not messages:
                        return [TextContent(type="text",
                                            text="No messages found in this "
                                                 "thread.")]
                    formatted = "\n".join([
                        f"[{m.get('created'
                                  '')}] {m.get('personEmail', '')}: "
                        f"{m.get('text', '')}"
                        for m in messages])
                    return [TextContent(type="text", text=formatted)]

                case _:
                    error_message = f"Unknown tool: {name}"
                    logger.error(error_message)
                    return CallToolResult(
                        isError=True,
                        content=[TextContent(type="text",
                                             text=f"Error: {error_message}")],
                    )
        except httpx.TimeoutException as e:
            logger.error(f"TimeoutException: {e}")
            raise McpError(
                ErrorData(code=INTERNAL_ERROR, message="Request timed out."))
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTPStatusError: {e}")
            raise McpError(
                ErrorData(
                    code=INTERNAL_ERROR,
                    message=f"HTTP error: {e.response.status_code} "
                            f"{e.response.text}",
                )
            )
        except httpx.RequestError as e:
            logger.error(f"RequestError: {e}")
            raise McpError(ErrorData(code=INTERNAL_ERROR,
                                     message="Request error occurred."))
        except ValueError as e:
            logger.error(e)
            raise McpError(ErrorData(code=INVALID_PARAMS, message=str(e)))
        except Exception as e:
            logger.error(f"Unhandled Exception: {e}")
            raise McpError(ErrorData(code=INTERNAL_ERROR,
                                     message="An internal error occurred."))

    return server
