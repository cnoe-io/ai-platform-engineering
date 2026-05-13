"""Model for Teammemberaddresult"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Teammemberaddresult(BaseModel):
  """Result of a single team member add operation"""


class TeammemberaddresultResponse(APIResponse):
  """Response model for Teammemberaddresult"""

  data: Optional[Teammemberaddresult] = None


class TeammemberaddresultListResponse(APIResponse):
  """List response model for Teammemberaddresult"""

  data: List[Teammemberaddresult] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
