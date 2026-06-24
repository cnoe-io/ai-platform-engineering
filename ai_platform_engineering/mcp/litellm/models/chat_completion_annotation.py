"""Model for Chatcompletionannotation"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionannotation(BaseModel):
  """Chatcompletionannotation model"""


class ChatcompletionannotationResponse(APIResponse):
  """Response model for Chatcompletionannotation"""

  data: Optional[Chatcompletionannotation] = None


class ChatcompletionannotationListResponse(APIResponse):
  """List response model for Chatcompletionannotation"""

  data: List[Chatcompletionannotation] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
