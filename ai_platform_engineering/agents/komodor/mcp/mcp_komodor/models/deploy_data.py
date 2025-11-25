"""Model for Deploydata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deploydata(BaseModel):
  """Deploydata model"""


class DeploydataResponse(APIResponse):
  """Response model for Deploydata"""

  data: Optional[Deploydata] = None


class DeploydataListResponse(APIResponse):
  """List response model for Deploydata"""

  data: List[Deploydata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
