"""Model for Listguardrailsubmissionsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Listguardrailsubmissionsresponse(BaseModel):
  """Listguardrailsubmissionsresponse model"""


class ListguardrailsubmissionsresponseResponse(APIResponse):
  """Response model for Listguardrailsubmissionsresponse"""

  data: Optional[Listguardrailsubmissionsresponse] = None


class ListguardrailsubmissionsresponseListResponse(APIResponse):
  """List response model for Listguardrailsubmissionsresponse"""

  data: List[Listguardrailsubmissionsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
