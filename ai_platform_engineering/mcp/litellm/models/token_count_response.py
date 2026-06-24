"""Model for Tokencountresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Tokencountresponse(BaseModel):
  """Tokencountresponse model"""


class TokencountresponseResponse(APIResponse):
  """Response model for Tokencountresponse"""

  data: Optional[Tokencountresponse] = None


class TokencountresponseListResponse(APIResponse):
  """List response model for Tokencountresponse"""

  data: List[Tokencountresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
