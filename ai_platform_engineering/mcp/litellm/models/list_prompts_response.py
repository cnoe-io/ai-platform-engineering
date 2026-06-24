"""Model for Listpromptsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Listpromptsresponse(BaseModel):
  """Listpromptsresponse model"""


class ListpromptsresponseResponse(APIResponse):
  """Response model for Listpromptsresponse"""

  data: Optional[Listpromptsresponse] = None


class ListpromptsresponseListResponse(APIResponse):
  """List response model for Listpromptsresponse"""

  data: List[Listpromptsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
