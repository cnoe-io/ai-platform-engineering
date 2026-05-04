"""Model for Testsearchtoolconnectionrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Testsearchtoolconnectionrequest(BaseModel):
  """Testsearchtoolconnectionrequest model"""


class TestsearchtoolconnectionrequestResponse(APIResponse):
  """Response model for Testsearchtoolconnectionrequest"""

  data: Optional[Testsearchtoolconnectionrequest] = None


class TestsearchtoolconnectionrequestListResponse(APIResponse):
  """List response model for Testsearchtoolconnectionrequest"""

  data: List[Testsearchtoolconnectionrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
