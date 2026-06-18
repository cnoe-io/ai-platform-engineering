"""Model for Basemodel"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Basemodel(BaseModel):
  """Basemodel model"""


class BasemodelResponse(APIResponse):
  """Response model for Basemodel"""

  data: Optional[Basemodel] = None


class BasemodelListResponse(APIResponse):
  """List response model for Basemodel"""

  data: List[Basemodel] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
