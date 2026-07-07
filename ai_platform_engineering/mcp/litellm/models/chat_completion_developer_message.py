"""Model for Chatcompletiondevelopermessage"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletiondevelopermessage(BaseModel):
  """Chatcompletiondevelopermessage model"""


class ChatcompletiondevelopermessageResponse(APIResponse):
  """Response model for Chatcompletiondevelopermessage"""

  data: Optional[Chatcompletiondevelopermessage] = None


class ChatcompletiondevelopermessageListResponse(APIResponse):
  """List response model for Chatcompletiondevelopermessage"""

  data: List[Chatcompletiondevelopermessage] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
