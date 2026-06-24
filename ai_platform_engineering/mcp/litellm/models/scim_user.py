"""Model for Scimuser"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scimuser(BaseModel):
  """Scimuser model"""


class ScimuserResponse(APIResponse):
  """Response model for Scimuser"""

  data: Optional[Scimuser] = None


class ScimuserListResponse(APIResponse):
  """List response model for Scimuser"""

  data: List[Scimuser] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
