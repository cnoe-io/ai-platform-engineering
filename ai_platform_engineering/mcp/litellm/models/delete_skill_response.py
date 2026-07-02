"""Model for Deleteskillresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deleteskillresponse(BaseModel):
  """Response from deleting a skill"""


class DeleteskillresponseResponse(APIResponse):
  """Response model for Deleteskillresponse"""

  data: Optional[Deleteskillresponse] = None


class DeleteskillresponseListResponse(APIResponse):
  """List response model for Deleteskillresponse"""

  data: List[Deleteskillresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
