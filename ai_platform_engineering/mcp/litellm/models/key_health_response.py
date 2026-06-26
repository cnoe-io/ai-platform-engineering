"""Model for Keyhealthresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Keyhealthresponse(BaseModel):
  """Keyhealthresponse model"""


class KeyhealthresponseResponse(APIResponse):
  """Response model for Keyhealthresponse"""

  data: Optional[Keyhealthresponse] = None


class KeyhealthresponseListResponse(APIResponse):
  """List response model for Keyhealthresponse"""

  data: List[Keyhealthresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
