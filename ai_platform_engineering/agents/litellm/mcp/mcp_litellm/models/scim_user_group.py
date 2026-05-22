"""Model for Scimusergroup"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scimusergroup(BaseModel):
  """Scimusergroup model"""


class ScimusergroupResponse(APIResponse):
  """Response model for Scimusergroup"""

  data: Optional[Scimusergroup] = None


class ScimusergroupListResponse(APIResponse):
  """List response model for Scimusergroup"""

  data: List[Scimusergroup] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
