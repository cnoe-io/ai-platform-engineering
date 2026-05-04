"""Model for Lakeracategorythresholds"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Lakeracategorythresholds(BaseModel):
  """Lakeracategorythresholds model"""


class LakeracategorythresholdsResponse(APIResponse):
  """Response model for Lakeracategorythresholds"""

  data: Optional[Lakeracategorythresholds] = None


class LakeracategorythresholdsListResponse(APIResponse):
  """List response model for Lakeracategorythresholds"""

  data: List[Lakeracategorythresholds] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
