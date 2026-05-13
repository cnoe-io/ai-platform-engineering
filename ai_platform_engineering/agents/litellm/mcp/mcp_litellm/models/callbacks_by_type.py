"""Model for Callbacksbytype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Callbacksbytype(BaseModel):
  """Callbacksbytype model"""


class CallbacksbytypeResponse(APIResponse):
  """Response model for Callbacksbytype"""

  data: Optional[Callbacksbytype] = None


class CallbacksbytypeListResponse(APIResponse):
  """List response model for Callbacksbytype"""

  data: List[Callbacksbytype] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
