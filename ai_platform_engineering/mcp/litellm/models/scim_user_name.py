"""Model for Scimusername"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scimusername(BaseModel):
  """Scimusername model"""


class ScimusernameResponse(APIResponse):
  """Response model for Scimusername"""

  data: Optional[Scimusername] = None


class ScimusernameListResponse(APIResponse):
  """List response model for Scimusername"""

  data: List[Scimusername] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
