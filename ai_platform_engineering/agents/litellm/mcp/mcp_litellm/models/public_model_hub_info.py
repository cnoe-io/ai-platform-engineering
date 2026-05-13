"""Model for Publicmodelhubinfo"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Publicmodelhubinfo(BaseModel):
  """Publicmodelhubinfo model"""


class PublicmodelhubinfoResponse(APIResponse):
  """Response model for Publicmodelhubinfo"""

  data: Optional[Publicmodelhubinfo] = None


class PublicmodelhubinfoListResponse(APIResponse):
  """List response model for Publicmodelhubinfo"""

  data: List[Publicmodelhubinfo] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
