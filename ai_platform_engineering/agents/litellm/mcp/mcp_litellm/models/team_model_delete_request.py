"""Model for Teammodeldeleterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Teammodeldeleterequest(BaseModel):
  """Request to delete models from a team"""


class TeammodeldeleterequestResponse(APIResponse):
  """Response model for Teammodeldeleterequest"""

  data: Optional[Teammodeldeleterequest] = None


class TeammodeldeleterequestListResponse(APIResponse):
  """List response model for Teammodeldeleterequest"""

  data: List[Teammodeldeleterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
