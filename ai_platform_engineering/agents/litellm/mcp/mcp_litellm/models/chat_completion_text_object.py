"""Model for Chatcompletiontextobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletiontextobject(BaseModel):
  """Chatcompletiontextobject model"""


class ChatcompletiontextobjectResponse(APIResponse):
  """Response model for Chatcompletiontextobject"""

  data: Optional[Chatcompletiontextobject] = None


class ChatcompletiontextobjectListResponse(APIResponse):
  """List response model for Chatcompletiontextobject"""

  data: List[Chatcompletiontextobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
