"""Model for Applyguardrailresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Applyguardrailresponse(BaseModel):
  """Applyguardrailresponse model"""


class ApplyguardrailresponseResponse(APIResponse):
  """Response model for Applyguardrailresponse"""

  data: Optional[Applyguardrailresponse] = None


class ApplyguardrailresponseListResponse(APIResponse):
  """List response model for Applyguardrailresponse"""

  data: List[Applyguardrailresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
