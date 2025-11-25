"""Model for Createmonitordto"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createmonitordto(BaseModel):
  """Createmonitordto model"""


class CreatemonitordtoResponse(APIResponse):
  """Response model for Createmonitordto"""

  data: Optional[Createmonitordto] = None


class CreatemonitordtoListResponse(APIResponse):
  """List response model for Createmonitordto"""

  data: List[Createmonitordto] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
