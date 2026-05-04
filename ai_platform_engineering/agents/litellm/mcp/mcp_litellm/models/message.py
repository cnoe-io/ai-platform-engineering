"""Model for Message"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Message(BaseModel):
  """Message model"""


class MessageResponse(APIResponse):
  """Response model for Message"""

  data: Optional[Message] = None


class MessageListResponse(APIResponse):
  """List response model for Message"""

  data: List[Message] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
