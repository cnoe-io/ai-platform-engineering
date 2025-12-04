"""Model for Createcustomactiondto"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createcustomactiondto(BaseModel):
  """Createcustomactiondto model"""


class CreatecustomactiondtoResponse(APIResponse):
  """Response model for Createcustomactiondto"""

  data: Optional[Createcustomactiondto] = None


class CreatecustomactiondtoListResponse(APIResponse):
  """List response model for Createcustomactiondto"""

  data: List[Createcustomactiondto] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
