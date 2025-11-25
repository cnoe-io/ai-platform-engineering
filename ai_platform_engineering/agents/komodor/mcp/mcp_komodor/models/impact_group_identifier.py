"""Model for Impactgroupidentifier"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Impactgroupidentifier(BaseModel):
  """Impactgroupidentifier model"""


class ImpactgroupidentifierResponse(APIResponse):
  """Response model for Impactgroupidentifier"""

  data: Optional[Impactgroupidentifier] = None


class ImpactgroupidentifierListResponse(APIResponse):
  """List response model for Impactgroupidentifier"""

  data: List[Impactgroupidentifier] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
