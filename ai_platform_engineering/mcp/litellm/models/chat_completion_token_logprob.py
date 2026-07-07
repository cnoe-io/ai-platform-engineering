"""Model for Chatcompletiontokenlogprob"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletiontokenlogprob(BaseModel):
  """Chatcompletiontokenlogprob model"""


class ChatcompletiontokenlogprobResponse(APIResponse):
  """Response model for Chatcompletiontokenlogprob"""

  data: Optional[Chatcompletiontokenlogprob] = None


class ChatcompletiontokenlogprobListResponse(APIResponse):
  """List response model for Chatcompletiontokenlogprob"""

  data: List[Chatcompletiontokenlogprob] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
