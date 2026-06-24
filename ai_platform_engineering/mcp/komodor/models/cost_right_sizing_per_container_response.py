"""Model for Costrightsizingpercontainerresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Costrightsizingpercontainerresponse(BaseModel):
  """Costrightsizingpercontainerresponse model"""


class CostrightsizingpercontainerresponseResponse(APIResponse):
  """Response model for Costrightsizingpercontainerresponse"""

  data: Optional[Costrightsizingpercontainerresponse] = None


class CostrightsizingpercontainerresponseListResponse(APIResponse):
  """List response model for Costrightsizingpercontainerresponse"""

  data: List[Costrightsizingpercontainerresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
