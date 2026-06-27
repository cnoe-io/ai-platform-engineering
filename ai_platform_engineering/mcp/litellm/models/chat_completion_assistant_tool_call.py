"""Model for Chatcompletionassistanttoolcall"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionassistanttoolcall(BaseModel):
  """Chatcompletionassistanttoolcall model"""


class ChatcompletionassistanttoolcallResponse(APIResponse):
  """Response model for Chatcompletionassistanttoolcall"""

  data: Optional[Chatcompletionassistanttoolcall] = None


class ChatcompletionassistanttoolcallListResponse(APIResponse):
  """List response model for Chatcompletionassistanttoolcall"""

  data: List[Chatcompletionassistanttoolcall] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
