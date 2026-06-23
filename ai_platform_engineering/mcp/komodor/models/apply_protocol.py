"""Model for Applyprotocol"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Applyprotocol(BaseModel):
  """When does a right sizing policy optimization apply?"""


class ApplyprotocolResponse(APIResponse):
  """Response model for Applyprotocol"""

  data: Optional[Applyprotocol] = None


class ApplyprotocolListResponse(APIResponse):
  """List response model for Applyprotocol"""

  data: List[Applyprotocol] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
