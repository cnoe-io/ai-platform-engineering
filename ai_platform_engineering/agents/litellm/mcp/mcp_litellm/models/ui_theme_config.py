"""Model for Uithemeconfig"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Uithemeconfig(BaseModel):
  """Configuration for UI theme customization"""


class UithemeconfigResponse(APIResponse):
  """Response model for Uithemeconfig"""

  data: Optional[Uithemeconfig] = None


class UithemeconfigListResponse(APIResponse):
  """List response model for Uithemeconfig"""

  data: List[Uithemeconfig] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
