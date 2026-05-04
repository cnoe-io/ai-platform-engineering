"""Model for Scimuseremail"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scimuseremail(BaseModel):
  """Scimuseremail model"""


class ScimuseremailResponse(APIResponse):
  """Response model for Scimuseremail"""

  data: Optional[Scimuseremail] = None


class ScimuseremailListResponse(APIResponse):
  """List response model for Scimuseremail"""

  data: List[Scimuseremail] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
