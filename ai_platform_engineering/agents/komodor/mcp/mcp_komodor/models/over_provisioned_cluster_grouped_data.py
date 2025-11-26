"""Model for Overprovisionedclustergroupeddata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Overprovisionedclustergroupeddata(BaseModel):
  """Overprovisionedclustergroupeddata model"""


class OverprovisionedclustergroupeddataResponse(APIResponse):
  """Response model for Overprovisionedclustergroupeddata"""

  data: Optional[Overprovisionedclustergroupeddata] = None


class OverprovisionedclustergroupeddataListResponse(APIResponse):
  """List response model for Overprovisionedclustergroupeddata"""

  data: List[Overprovisionedclustergroupeddata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
