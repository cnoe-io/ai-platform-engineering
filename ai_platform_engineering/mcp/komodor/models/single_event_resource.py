"""Model for Singleeventresource"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Singleeventresource(BaseModel):
  """Singleeventresource model"""


class SingleeventresourceResponse(APIResponse):
  """Response model for Singleeventresource"""

  data: Optional[Singleeventresource] = None


class SingleeventresourceListResponse(APIResponse):
  """List response model for Singleeventresource"""

  data: List[Singleeventresource] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
