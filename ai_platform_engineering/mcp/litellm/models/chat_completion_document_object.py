"""Model for Chatcompletiondocumentobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletiondocumentobject(BaseModel):
  """Chatcompletiondocumentobject model"""


class ChatcompletiondocumentobjectResponse(APIResponse):
  """Response model for Chatcompletiondocumentobject"""

  data: Optional[Chatcompletiondocumentobject] = None


class ChatcompletiondocumentobjectListResponse(APIResponse):
  """List response model for Chatcompletiondocumentobject"""

  data: List[Chatcompletiondocumentobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
