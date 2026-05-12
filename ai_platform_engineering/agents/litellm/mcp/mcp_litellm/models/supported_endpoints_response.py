"""Model for Supportedendpointsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Supportedendpointsresponse(BaseModel):
  """Supportedendpointsresponse model"""


class SupportedendpointsresponseResponse(APIResponse):
  """Response model for Supportedendpointsresponse"""

  data: Optional[Supportedendpointsresponse] = None


class SupportedendpointsresponseListResponse(APIResponse):
  """List response model for Supportedendpointsresponse"""

  data: List[Supportedendpointsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
