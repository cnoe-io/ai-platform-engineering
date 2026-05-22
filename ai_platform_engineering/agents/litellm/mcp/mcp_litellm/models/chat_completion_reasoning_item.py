"""Model for Chatcompletionreasoningitem"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionreasoningitem(BaseModel):
  """Represents an OpenAI Responses API reasoning item for round-tripping in conversation history."""


class ChatcompletionreasoningitemResponse(APIResponse):
  """Response model for Chatcompletionreasoningitem"""

  data: Optional[Chatcompletionreasoningitem] = None


class ChatcompletionreasoningitemListResponse(APIResponse):
  """List response model for Chatcompletionreasoningitem"""

  data: List[Chatcompletionreasoningitem] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
