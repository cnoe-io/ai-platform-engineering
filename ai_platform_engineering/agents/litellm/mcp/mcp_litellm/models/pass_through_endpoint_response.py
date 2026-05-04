"""Model for Passthroughendpointresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Passthroughendpointresponse(BaseModel):
  """Passthroughendpointresponse model"""


class PassthroughendpointresponseResponse(APIResponse):
  """Response model for Passthroughendpointresponse"""

  data: Optional[Passthroughendpointresponse] = None


class PassthroughendpointresponseListResponse(APIResponse):
  """List response model for Passthroughendpointresponse"""

  data: List[Passthroughendpointresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
