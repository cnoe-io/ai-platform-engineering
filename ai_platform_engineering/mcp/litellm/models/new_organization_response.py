"""Model for Neworganizationresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Neworganizationresponse(BaseModel):
  """Neworganizationresponse model"""


class NeworganizationresponseResponse(APIResponse):
  """Response model for Neworganizationresponse"""

  data: Optional[Neworganizationresponse] = None


class NeworganizationresponseListResponse(APIResponse):
  """List response model for Neworganizationresponse"""

  data: List[Neworganizationresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
