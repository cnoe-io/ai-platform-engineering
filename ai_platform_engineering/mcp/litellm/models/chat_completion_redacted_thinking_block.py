"""Model for Chatcompletionredactedthinkingblock"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionredactedthinkingblock(BaseModel):
  """Chatcompletionredactedthinkingblock model"""


class ChatcompletionredactedthinkingblockResponse(APIResponse):
  """Response model for Chatcompletionredactedthinkingblock"""

  data: Optional[Chatcompletionredactedthinkingblock] = None


class ChatcompletionredactedthinkingblockListResponse(APIResponse):
  """List response model for Chatcompletionredactedthinkingblock"""

  data: List[Chatcompletionredactedthinkingblock] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
