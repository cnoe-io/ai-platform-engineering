"""Model for Paginatedauditlogresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Paginatedauditlogresponse(BaseModel):
  """Response model for paginated audit logs"""


class PaginatedauditlogresponseResponse(APIResponse):
  """Response model for Paginatedauditlogresponse"""

  data: Optional[Paginatedauditlogresponse] = None


class PaginatedauditlogresponseListResponse(APIResponse):
  """List response model for Paginatedauditlogresponse"""

  data: List[Paginatedauditlogresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
