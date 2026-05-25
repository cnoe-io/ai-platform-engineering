"""Model for Scimpatchoperation"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scimpatchoperation(BaseModel):
  """Scimpatchoperation model"""


class ScimpatchoperationResponse(APIResponse):
  """Response model for Scimpatchoperation"""

  data: Optional[Scimpatchoperation] = None


class ScimpatchoperationListResponse(APIResponse):
  """List response model for Scimpatchoperation"""

  data: List[Scimpatchoperation] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
