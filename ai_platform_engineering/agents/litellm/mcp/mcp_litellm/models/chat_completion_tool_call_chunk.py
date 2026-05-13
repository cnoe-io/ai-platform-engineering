"""Model for Chatcompletiontoolcallchunk"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletiontoolcallchunk(BaseModel):
  """Chatcompletiontoolcallchunk model"""


class ChatcompletiontoolcallchunkResponse(APIResponse):
  """Response model for Chatcompletiontoolcallchunk"""

  data: Optional[Chatcompletiontoolcallchunk] = None


class ChatcompletiontoolcallchunkListResponse(APIResponse):
  """List response model for Chatcompletiontoolcallchunk"""

  data: List[Chatcompletiontoolcallchunk] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
