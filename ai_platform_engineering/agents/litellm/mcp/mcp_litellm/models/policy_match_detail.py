"""Model for Policymatchdetail"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policymatchdetail(BaseModel):
  """Details about why a specific policy matched."""


class PolicymatchdetailResponse(APIResponse):
  """Response model for Policymatchdetail"""

  data: Optional[Policymatchdetail] = None


class PolicymatchdetailListResponse(APIResponse):
  """List response model for Policymatchdetail"""

  data: List[Policymatchdetail] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
