"""Model for Createcustomeventresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createcustomeventresponse(BaseModel):
  """Createcustomeventresponse model"""


class CreatecustomeventresponseResponse(APIResponse):
  """Response model for Createcustomeventresponse"""

  data: Optional[Createcustomeventresponse] = None


class CreatecustomeventresponseListResponse(APIResponse):
  """List response model for Createcustomeventresponse"""

  data: List[Createcustomeventresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
