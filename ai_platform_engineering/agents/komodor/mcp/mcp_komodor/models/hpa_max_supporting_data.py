"""Model for Hpamaxsupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Hpamaxsupportingdata(BaseModel):
  """Hpamaxsupportingdata model"""


class HpamaxsupportingdataResponse(APIResponse):
  """Response model for Hpamaxsupportingdata"""

  data: Optional[Hpamaxsupportingdata] = None


class HpamaxsupportingdataListResponse(APIResponse):
  """List response model for Hpamaxsupportingdata"""

  data: List[Hpamaxsupportingdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
