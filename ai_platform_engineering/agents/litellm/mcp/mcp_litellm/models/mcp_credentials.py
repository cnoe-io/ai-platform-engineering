"""Model for Mcpcredentials"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mcpcredentials(BaseModel):
  """Mcpcredentials model"""


class McpcredentialsResponse(APIResponse):
  """Response model for Mcpcredentials"""

  data: Optional[Mcpcredentials] = None


class McpcredentialsListResponse(APIResponse):
  """List response model for Mcpcredentials"""

  data: List[Mcpcredentials] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
