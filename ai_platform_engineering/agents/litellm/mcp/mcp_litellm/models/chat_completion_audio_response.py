"""Model for Chatcompletionaudioresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionaudioresponse(BaseModel):
  """Chatcompletionaudioresponse model"""


class ChatcompletionaudioresponseResponse(APIResponse):
  """Response model for Chatcompletionaudioresponse"""

  data: Optional[Chatcompletionaudioresponse] = None


class ChatcompletionaudioresponseListResponse(APIResponse):
  """List response model for Chatcompletionaudioresponse"""

  data: List[Chatcompletionaudioresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
