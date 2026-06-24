"""Model for Chatcompletiontoolparamfunctionchunk"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletiontoolparamfunctionchunk(BaseModel):
  """Chatcompletiontoolparamfunctionchunk model"""


class ChatcompletiontoolparamfunctionchunkResponse(APIResponse):
  """Response model for Chatcompletiontoolparamfunctionchunk"""

  data: Optional[Chatcompletiontoolparamfunctionchunk] = None


class ChatcompletiontoolparamfunctionchunkListResponse(APIResponse):
  """List response model for Chatcompletiontoolparamfunctionchunk"""

  data: List[Chatcompletiontoolparamfunctionchunk] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
