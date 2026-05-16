"""Model for Scimmember"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scimmember(BaseModel):
  """Scimmember model"""


class ScimmemberResponse(APIResponse):
  """Response model for Scimmember"""

  data: Optional[Scimmember] = None


class ScimmemberListResponse(APIResponse):
  """List response model for Scimmember"""

  data: List[Scimmember] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
