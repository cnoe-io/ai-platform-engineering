"""Model for Actiontype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Actiontype(BaseModel):
  """Actiontype model"""


class ActiontypeResponse(APIResponse):
  """Response model for Actiontype"""

  data: Optional[Actiontype] = None


class ActiontypeListResponse(APIResponse):
  """List response model for Actiontype"""

  data: List[Actiontype] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
