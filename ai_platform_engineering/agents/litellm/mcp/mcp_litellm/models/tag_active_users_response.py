"""Model for Tagactiveusersresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Tagactiveusersresponse(BaseModel):
  """Response for tag active users metrics"""


class TagactiveusersresponseResponse(APIResponse):
  """Response model for Tagactiveusersresponse"""

  data: Optional[Tagactiveusersresponse] = None


class TagactiveusersresponseListResponse(APIResponse):
  """List response model for Tagactiveusersresponse"""

  data: List[Tagactiveusersresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
