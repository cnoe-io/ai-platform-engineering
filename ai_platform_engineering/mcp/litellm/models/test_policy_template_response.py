"""Model for Testpolicytemplateresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Testpolicytemplateresponse(BaseModel):
  """Testpolicytemplateresponse model"""


class TestpolicytemplateresponseResponse(APIResponse):
  """Response model for Testpolicytemplateresponse"""

  data: Optional[Testpolicytemplateresponse] = None


class TestpolicytemplateresponseListResponse(APIResponse):
  """List response model for Testpolicytemplateresponse"""

  data: List[Testpolicytemplateresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
