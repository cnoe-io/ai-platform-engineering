# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

from typing import List

from pydantic import BaseModel
from pydantic.fields import Field


class ChatBotQuestion(BaseModel):
  """
  A Pydantic model representing a question submitted to the chat bot along with associated metadata.

  Attributes:
  - chat_id (str): Unique identifier for the chat session.
  - question (str): The question text submitted by the user.
  """

  chat_id: str
  question: str

class UserInputRequest(BaseModel):
  """An input that the user should provide for the agent to be able to take action."""

  field_name: str = Field(description="The name of the field that should be provided.")
  field_description: str = Field(
    description="A description of what this field represents and how it will be used.",
  )
  field_values: List[str] = Field(
    description="A list of possible values that the user can provide for this field.",
  )


class AgentResponseMetadata(BaseModel):
  """Metadata about the response from Agent."""

  user_input: bool = Field(description="Indicates if the response requires user input")
  input_fields: list[UserInputRequest]


class AgentResponse(BaseModel):
  """Response from Agent Agent."""

  answer: str = Field(description="The response from the Agent")
  metadata: AgentResponseMetadata = Field(
    description="""Metadata about the response. Set user_input if the response has user input and \
corresponding and input fields""",
  )