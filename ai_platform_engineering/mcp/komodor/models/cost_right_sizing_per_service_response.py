"""Model for Costrightsizingperserviceresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Costrightsizingperserviceresponse(BaseModel):
  """Costrightsizingperserviceresponse model"""


class CostrightsizingperserviceresponseResponse(APIResponse):
  """Response model for Costrightsizingperserviceresponse"""

  data: Optional[Costrightsizingperserviceresponse] = None


class CostrightsizingperserviceresponseListResponse(APIResponse):
  """List response model for Costrightsizingperserviceresponse"""

  data: List[Costrightsizingperserviceresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
