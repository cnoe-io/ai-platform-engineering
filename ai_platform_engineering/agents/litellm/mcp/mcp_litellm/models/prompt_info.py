"""Model for Promptinfo"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Promptinfo(BaseModel):
  """Promptinfo model"""


class PromptinfoResponse(APIResponse):
  """Response model for Promptinfo"""

  data: Optional[Promptinfo] = None


class PromptinfoListResponse(APIResponse):
  """List response model for Promptinfo"""

  data: List[Promptinfo] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
