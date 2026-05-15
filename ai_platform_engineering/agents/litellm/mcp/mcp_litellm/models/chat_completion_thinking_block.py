"""Model for Chatcompletionthinkingblock"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionthinkingblock(BaseModel):
  """Chatcompletionthinkingblock model"""


class ChatcompletionthinkingblockResponse(APIResponse):
  """Response model for Chatcompletionthinkingblock"""

  data: Optional[Chatcompletionthinkingblock] = None


class ChatcompletionthinkingblockListResponse(APIResponse):
  """List response model for Chatcompletionthinkingblock"""

  data: List[Chatcompletionthinkingblock] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
