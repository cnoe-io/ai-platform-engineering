"""Model for Chatcompletioncachedcontent"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletioncachedcontent(BaseModel):
  """Chatcompletioncachedcontent model"""


class ChatcompletioncachedcontentResponse(APIResponse):
  """Response model for Chatcompletioncachedcontent"""

  data: Optional[Chatcompletioncachedcontent] = None


class ChatcompletioncachedcontentListResponse(APIResponse):
  """List response model for Chatcompletioncachedcontent"""

  data: List[Chatcompletioncachedcontent] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
