"""Model for Taginforequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Taginforequest(BaseModel):
  """Taginforequest model"""


class TaginforequestResponse(APIResponse):
  """Response model for Taginforequest"""

  data: Optional[Taginforequest] = None


class TaginforequestListResponse(APIResponse):
  """List response model for Taginforequest"""

  data: List[Taginforequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
