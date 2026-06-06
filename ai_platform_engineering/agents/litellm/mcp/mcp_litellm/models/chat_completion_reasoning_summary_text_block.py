"""Model for Chatcompletionreasoningsummarytextblock"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionreasoningsummarytextblock(BaseModel):
  """Chatcompletionreasoningsummarytextblock model"""


class ChatcompletionreasoningsummarytextblockResponse(APIResponse):
  """Response model for Chatcompletionreasoningsummarytextblock"""

  data: Optional[Chatcompletionreasoningsummarytextblock] = None


class ChatcompletionreasoningsummarytextblockListResponse(APIResponse):
  """List response model for Chatcompletionreasoningsummarytextblock"""

  data: List[Chatcompletionreasoningsummarytextblock] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
