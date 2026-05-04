"""Model for Httpvalidationerror"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Httpvalidationerror(BaseModel):
  """Httpvalidationerror model"""


class HttpvalidationerrorResponse(APIResponse):
  """Response model for Httpvalidationerror"""

  data: Optional[Httpvalidationerror] = None


class HttpvalidationerrorListResponse(APIResponse):
  """List response model for Httpvalidationerror"""

  data: List[Httpvalidationerror] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
