"""Model for Extendedviolation"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Extendedviolation(BaseModel):
  """Extendedviolation model"""


class ExtendedviolationResponse(APIResponse):
  """Response model for Extendedviolation"""

  data: Optional[Extendedviolation] = None


class ExtendedviolationListResponse(APIResponse):
  """List response model for Extendedviolation"""

  data: List[Extendedviolation] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
