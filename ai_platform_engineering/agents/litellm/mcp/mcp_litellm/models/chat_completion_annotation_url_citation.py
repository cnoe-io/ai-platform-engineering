"""Model for Chatcompletionannotationurlcitation"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionannotationurlcitation(BaseModel):
  """Chatcompletionannotationurlcitation model"""


class ChatcompletionannotationurlcitationResponse(APIResponse):
  """Response model for Chatcompletionannotationurlcitation"""

  data: Optional[Chatcompletionannotationurlcitation] = None


class ChatcompletionannotationurlcitationListResponse(APIResponse):
  """List response model for Chatcompletionannotationurlcitation"""

  data: List[Chatcompletionannotationurlcitation] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
