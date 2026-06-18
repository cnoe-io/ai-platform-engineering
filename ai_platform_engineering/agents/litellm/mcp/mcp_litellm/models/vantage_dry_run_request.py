"""Model for Vantagedryrunrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Vantagedryrunrequest(BaseModel):
  """Request model for Vantage dry-run operations (capped for preview)"""


class VantagedryrunrequestResponse(APIResponse):
  """Response model for Vantagedryrunrequest"""

  data: Optional[Vantagedryrunrequest] = None


class VantagedryrunrequestListResponse(APIResponse):
  """List response model for Vantagedryrunrequest"""

  data: List[Vantagedryrunrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
