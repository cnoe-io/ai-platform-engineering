"""Model for Inproductnudgeresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Inproductnudgeresponse(BaseModel):
  """Inproductnudgeresponse model"""


class InproductnudgeresponseResponse(APIResponse):
  """Response model for Inproductnudgeresponse"""

  data: Optional[Inproductnudgeresponse] = None


class InproductnudgeresponseListResponse(APIResponse):
  """List response model for Inproductnudgeresponse"""

  data: List[Inproductnudgeresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
