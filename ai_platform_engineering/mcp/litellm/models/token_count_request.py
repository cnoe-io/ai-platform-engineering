"""Model for Tokencountrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Tokencountrequest(BaseModel):
  """Tokencountrequest model"""


class TokencountrequestResponse(APIResponse):
  """Response model for Tokencountrequest"""

  data: Optional[Tokencountrequest] = None


class TokencountrequestListResponse(APIResponse):
  """List response model for Tokencountrequest"""

  data: List[Tokencountrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
