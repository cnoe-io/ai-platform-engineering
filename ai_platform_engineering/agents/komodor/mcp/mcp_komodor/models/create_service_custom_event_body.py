"""Model for Createservicecustomeventbody"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createservicecustomeventbody(BaseModel):
  """Createservicecustomeventbody model"""


class CreateservicecustomeventbodyResponse(APIResponse):
  """Response model for Createservicecustomeventbody"""

  data: Optional[Createservicecustomeventbody] = None


class CreateservicecustomeventbodyListResponse(APIResponse):
  """List response model for Createservicecustomeventbody"""

  data: List[Createservicecustomeventbody] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
