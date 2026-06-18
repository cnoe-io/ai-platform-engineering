"""Model for Blockusers"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Blockusers(BaseModel):
  """Blockusers model"""


class BlockusersResponse(APIResponse):
  """Response model for Blockusers"""

  data: Optional[Blockusers] = None


class BlockusersListResponse(APIResponse):
  """List response model for Blockusers"""

  data: List[Blockusers] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
