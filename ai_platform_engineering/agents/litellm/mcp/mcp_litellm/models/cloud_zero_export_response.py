"""Model for Cloudzeroexportresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cloudzeroexportresponse(BaseModel):
  """Response model for CloudZero export operations"""


class CloudzeroexportresponseResponse(APIResponse):
  """Response model for Cloudzeroexportresponse"""

  data: Optional[Cloudzeroexportresponse] = None


class CloudzeroexportresponseListResponse(APIResponse):
  """List response model for Cloudzeroexportresponse"""

  data: List[Cloudzeroexportresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
