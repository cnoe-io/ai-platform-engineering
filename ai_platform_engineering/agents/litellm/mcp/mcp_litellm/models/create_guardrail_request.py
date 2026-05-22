"""Model for Createguardrailrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createguardrailrequest(BaseModel):
  """Createguardrailrequest model"""


class CreateguardrailrequestResponse(APIResponse):
  """Response model for Createguardrailrequest"""

  data: Optional[Createguardrailrequest] = None


class CreateguardrailrequestListResponse(APIResponse):
  """List response model for Createguardrailrequest"""

  data: List[Createguardrailrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
