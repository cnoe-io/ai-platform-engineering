"""Model for Applyguardrailrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Applyguardrailrequest(BaseModel):
  """Applyguardrailrequest model"""


class ApplyguardrailrequestResponse(APIResponse):
  """Response model for Applyguardrailrequest"""

  data: Optional[Applyguardrailrequest] = None


class ApplyguardrailrequestListResponse(APIResponse):
  """List response model for Applyguardrailrequest"""

  data: List[Applyguardrailrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
