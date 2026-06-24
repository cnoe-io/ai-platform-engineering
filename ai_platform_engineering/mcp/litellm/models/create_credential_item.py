"""Model for Createcredentialitem"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createcredentialitem(BaseModel):
  """Createcredentialitem model"""


class CreatecredentialitemResponse(APIResponse):
  """Response model for Createcredentialitem"""

  data: Optional[Createcredentialitem] = None


class CreatecredentialitemListResponse(APIResponse):
  """List response model for Createcredentialitem"""

  data: List[Createcredentialitem] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
