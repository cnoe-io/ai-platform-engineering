"""Model for Addteamcallback"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Addteamcallback(BaseModel):
  """Addteamcallback model"""


class AddteamcallbackResponse(APIResponse):
  """Response model for Addteamcallback"""

  data: Optional[Addteamcallback] = None


class AddteamcallbackListResponse(APIResponse):
  """List response model for Addteamcallback"""

  data: List[Addteamcallback] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
