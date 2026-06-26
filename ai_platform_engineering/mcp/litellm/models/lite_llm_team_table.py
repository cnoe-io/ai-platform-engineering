"""Model for LitellmTeamtable"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmTeamtable(BaseModel):
  """LitellmTeamtable model"""


class LitellmTeamtableResponse(APIResponse):
  """Response model for LitellmTeamtable"""

  data: Optional[LitellmTeamtable] = None


class LitellmTeamtableListResponse(APIResponse):
  """List response model for LitellmTeamtable"""

  data: List[LitellmTeamtable] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
