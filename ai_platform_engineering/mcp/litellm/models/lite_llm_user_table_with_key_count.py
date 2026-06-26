"""Model for LitellmUsertablewithkeycount"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmUsertablewithkeycount(BaseModel):
  """LitellmUsertablewithkeycount model"""


class LitellmUsertablewithkeycountResponse(APIResponse):
  """Response model for LitellmUsertablewithkeycount"""

  data: Optional[LitellmUsertablewithkeycount] = None


class LitellmUsertablewithkeycountListResponse(APIResponse):
  """List response model for LitellmUsertablewithkeycount"""

  data: List[LitellmUsertablewithkeycount] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
