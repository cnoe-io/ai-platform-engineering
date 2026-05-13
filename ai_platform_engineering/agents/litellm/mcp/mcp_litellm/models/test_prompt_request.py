"""Model for Testpromptrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Testpromptrequest(BaseModel):
  """Testpromptrequest model"""


class TestpromptrequestResponse(APIResponse):
  """Response model for Testpromptrequest"""

  data: Optional[Testpromptrequest] = None


class TestpromptrequestListResponse(APIResponse):
  """List response model for Testpromptrequest"""

  data: List[Testpromptrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
