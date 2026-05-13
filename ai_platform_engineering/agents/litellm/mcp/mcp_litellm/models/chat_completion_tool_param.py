"""Model for Chatcompletiontoolparam"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletiontoolparam(BaseModel):
  """Chatcompletiontoolparam model"""


class ChatcompletiontoolparamResponse(APIResponse):
  """Response model for Chatcompletiontoolparam"""

  data: Optional[Chatcompletiontoolparam] = None


class ChatcompletiontoolparamListResponse(APIResponse):
  """List response model for Chatcompletiontoolparam"""

  data: List[Chatcompletiontoolparam] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
