"""Model for Paginatedauditlogs"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Paginatedauditlogs(BaseModel):
  """Paginatedauditlogs model"""


class PaginatedauditlogsResponse(APIResponse):
  """Response model for Paginatedauditlogs"""

  data: Optional[Paginatedauditlogs] = None


class PaginatedauditlogsListResponse(APIResponse):
  """List response model for Paginatedauditlogs"""

  data: List[Paginatedauditlogs] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
