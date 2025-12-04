"""Model for Paginationparamswrapper"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Paginationparamswrapper(BaseModel):
  """Paginationparamswrapper model"""


class PaginationparamswrapperResponse(APIResponse):
  """Response model for Paginationparamswrapper"""

  data: Optional[Paginationparamswrapper] = None


class PaginationparamswrapperListResponse(APIResponse):
  """List response model for Paginationparamswrapper"""

  data: List[Paginationparamswrapper] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
