"""Model for Chatcompletionimageurlobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionimageurlobject(BaseModel):
  """Chatcompletionimageurlobject model"""


class ChatcompletionimageurlobjectResponse(APIResponse):
  """Response model for Chatcompletionimageurlobject"""

  data: Optional[Chatcompletionimageurlobject] = None


class ChatcompletionimageurlobjectListResponse(APIResponse):
  """List response model for Chatcompletionimageurlobject"""

  data: List[Chatcompletionimageurlobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
