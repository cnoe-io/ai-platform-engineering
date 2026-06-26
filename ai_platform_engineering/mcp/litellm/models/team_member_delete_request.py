"""Model for Teammemberdeleterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Teammemberdeleterequest(BaseModel):
  """Teammemberdeleterequest model"""


class TeammemberdeleterequestResponse(APIResponse):
  """Response model for Teammemberdeleterequest"""

  data: Optional[Teammemberdeleterequest] = None


class TeammemberdeleterequestListResponse(APIResponse):
  """List response model for Teammemberdeleterequest"""

  data: List[Teammemberdeleterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
