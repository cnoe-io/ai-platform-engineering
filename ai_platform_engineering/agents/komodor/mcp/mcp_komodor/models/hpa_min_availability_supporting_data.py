"""Model for Hpaminavailabilitysupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Hpaminavailabilitysupportingdata(BaseModel):
  """Hpaminavailabilitysupportingdata model"""


class HpaminavailabilitysupportingdataResponse(APIResponse):
  """Response model for Hpaminavailabilitysupportingdata"""

  data: Optional[Hpaminavailabilitysupportingdata] = None


class HpaminavailabilitysupportingdataListResponse(APIResponse):
  """List response model for Hpaminavailabilitysupportingdata"""

  data: List[Hpaminavailabilitysupportingdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
