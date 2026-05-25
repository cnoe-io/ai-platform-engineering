"""Model for Choices"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Choices(BaseModel):
  """Choices model"""


class ChoicesResponse(APIResponse):
  """Response model for Choices"""

  data: Optional[Choices] = None


class ChoicesListResponse(APIResponse):
  """List response model for Choices"""

  data: List[Choices] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
