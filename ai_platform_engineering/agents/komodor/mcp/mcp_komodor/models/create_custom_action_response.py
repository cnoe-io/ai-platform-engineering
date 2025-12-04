"""Model for Createcustomactionresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createcustomactionresponse(BaseModel):
  """Createcustomactionresponse model"""


class CreatecustomactionresponseResponse(APIResponse):
  """Response model for Createcustomactionresponse"""

  data: Optional[Createcustomactionresponse] = None


class CreatecustomactionresponseListResponse(APIResponse):
  """List response model for Createcustomactionresponse"""

  data: List[Createcustomactionresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
