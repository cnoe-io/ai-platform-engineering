"""Model for Realtimecheckssupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Realtimecheckssupportingdata(BaseModel):
  """Realtimecheckssupportingdata model"""


class RealtimecheckssupportingdataResponse(APIResponse):
  """Response model for Realtimecheckssupportingdata"""

  data: Optional[Realtimecheckssupportingdata] = None


class RealtimecheckssupportingdataListResponse(APIResponse):
  """List response model for Realtimecheckssupportingdata"""

  data: List[Realtimecheckssupportingdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
