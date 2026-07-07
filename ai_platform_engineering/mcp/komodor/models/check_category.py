"""Model for Checkcategory"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Checkcategory(BaseModel):
  """Checkcategory model"""


class CheckcategoryResponse(APIResponse):
  """Response model for Checkcategory"""

  data: Optional[Checkcategory] = None


class CheckcategoryListResponse(APIResponse):
  """List response model for Checkcategory"""

  data: List[Checkcategory] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
