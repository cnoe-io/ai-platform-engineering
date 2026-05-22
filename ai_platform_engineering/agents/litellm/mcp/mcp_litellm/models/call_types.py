"""Model for Calltypes"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Calltypes(BaseModel):
  """Calltypes model"""


class CalltypesResponse(APIResponse):
  """Response model for Calltypes"""

  data: Optional[Calltypes] = None


class CalltypesListResponse(APIResponse):
  """List response model for Calltypes"""

  data: List[Calltypes] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
