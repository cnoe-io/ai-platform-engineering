"""Model for Imageurllistitem"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Imageurllistitem(BaseModel):
  """Imageurllistitem model"""


class ImageurllistitemResponse(APIResponse):
  """Response model for Imageurllistitem"""

  data: Optional[Imageurllistitem] = None


class ImageurllistitemListResponse(APIResponse):
  """List response model for Imageurllistitem"""

  data: List[Imageurllistitem] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
