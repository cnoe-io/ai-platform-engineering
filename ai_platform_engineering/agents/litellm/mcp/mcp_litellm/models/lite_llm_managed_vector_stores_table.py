"""Model for LitellmManagedvectorstorestable"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmManagedvectorstorestable(BaseModel):
  """LitellmManagedvectorstorestable model"""


class LitellmManagedvectorstorestableResponse(APIResponse):
  """Response model for LitellmManagedvectorstorestable"""

  data: Optional[LitellmManagedvectorstorestable] = None


class LitellmManagedvectorstorestableListResponse(APIResponse):
  """List response model for LitellmManagedvectorstorestable"""

  data: List[LitellmManagedvectorstorestable] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
