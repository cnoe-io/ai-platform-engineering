"""Model for Singleissue"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Singleissue(BaseModel):
  """Singleissue model"""


class SingleissueResponse(APIResponse):
  """Response model for Singleissue"""

  data: Optional[Singleissue] = None


class SingleissueListResponse(APIResponse):
  """List response model for Singleissue"""

  data: List[Singleissue] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
