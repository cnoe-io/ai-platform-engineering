"""Model for Chatcompletionaudioobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionaudioobject(BaseModel):
  """Chatcompletionaudioobject model"""


class ChatcompletionaudioobjectResponse(APIResponse):
  """Response model for Chatcompletionaudioobject"""

  data: Optional[Chatcompletionaudioobject] = None


class ChatcompletionaudioobjectListResponse(APIResponse):
  """List response model for Chatcompletionaudioobject"""

  data: List[Chatcompletionaudioobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
