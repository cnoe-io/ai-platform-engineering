"""Model for Vantagesettingsview"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Vantagesettingsview(BaseModel):
  """Response model for viewing Vantage settings with masked API key"""


class VantagesettingsviewResponse(APIResponse):
  """Response model for Vantagesettingsview"""

  data: Optional[Vantagesettingsview] = None


class VantagesettingsviewListResponse(APIResponse):
  """List response model for Vantagesettingsview"""

  data: List[Vantagesettingsview] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
