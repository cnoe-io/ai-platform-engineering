"""Model for Blockedword"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Blockedword(BaseModel):
  """Represents a blocked word with its action and optional description"""


class BlockedwordResponse(APIResponse):
  """Response model for Blockedword"""

  data: Optional[Blockedword] = None


class BlockedwordListResponse(APIResponse):
  """List response model for Blockedword"""

  data: List[Blockedword] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
