"""Model for Tagdeleterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Tagdeleterequest(BaseModel):
  """Tagdeleterequest model"""


class TagdeleterequestResponse(APIResponse):
  """Response model for Tagdeleterequest"""

  data: Optional[Tagdeleterequest] = None


class TagdeleterequestListResponse(APIResponse):
  """List response model for Tagdeleterequest"""

  data: List[Tagdeleterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
