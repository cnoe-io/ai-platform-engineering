"""Model for Chatcompletiontoolcallfunctionchunk"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletiontoolcallfunctionchunk(BaseModel):
  """Chatcompletiontoolcallfunctionchunk model"""


class ChatcompletiontoolcallfunctionchunkResponse(APIResponse):
  """Response model for Chatcompletiontoolcallfunctionchunk"""

  data: Optional[Chatcompletiontoolcallfunctionchunk] = None


class ChatcompletiontoolcallfunctionchunkListResponse(APIResponse):
  """List response model for Chatcompletiontoolcallfunctionchunk"""

  data: List[Chatcompletiontoolcallfunctionchunk] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
