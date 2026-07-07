"""Model for Pattern"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Pattern(BaseModel):
  """Pattern model"""


class PatternResponse(APIResponse):
  """Response model for Pattern"""

  data: Optional[Pattern] = None


class PatternListResponse(APIResponse):
  """List response model for Pattern"""

  data: List[Pattern] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
