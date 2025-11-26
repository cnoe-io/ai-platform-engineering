"""Model for Externaldnsnotsyncedsupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Externaldnsnotsyncedsupportingdata(BaseModel):
  """Externaldnsnotsyncedsupportingdata model"""


class ExternaldnsnotsyncedsupportingdataResponse(APIResponse):
  """Response model for Externaldnsnotsyncedsupportingdata"""

  data: Optional[Externaldnsnotsyncedsupportingdata] = None


class ExternaldnsnotsyncedsupportingdataListResponse(APIResponse):
  """List response model for Externaldnsnotsyncedsupportingdata"""

  data: List[Externaldnsnotsyncedsupportingdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
