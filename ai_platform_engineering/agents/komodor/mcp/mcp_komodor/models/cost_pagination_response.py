"""Model for Costpaginationresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Costpaginationresponse(BaseModel):
  """Costpaginationresponse model"""


class CostpaginationresponseResponse(APIResponse):
  """Response model for Costpaginationresponse"""

  data: Optional[Costpaginationresponse] = None


class CostpaginationresponseListResponse(APIResponse):
  """List response model for Costpaginationresponse"""

  data: List[Costpaginationresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
