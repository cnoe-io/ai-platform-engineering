"""Model for Litellmkeytype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Litellmkeytype(BaseModel):
  """Enum for key types that determine what routes a key can access"""


class LitellmkeytypeResponse(APIResponse):
  """Response model for Litellmkeytype"""

  data: Optional[Litellmkeytype] = None


class LitellmkeytypeListResponse(APIResponse):
  """List response model for Litellmkeytype"""

  data: List[Litellmkeytype] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
