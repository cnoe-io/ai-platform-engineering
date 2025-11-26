"""Model for Httprequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Httprequest(BaseModel):
  """Httprequest model"""


class HttprequestResponse(APIResponse):
  """Response model for Httprequest"""

  data: Optional[Httprequest] = None


class HttprequestListResponse(APIResponse):
  """List response model for Httprequest"""

  data: List[Httprequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
