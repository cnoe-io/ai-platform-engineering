"""Model for Testpolicytemplaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Testpolicytemplaterequest(BaseModel):
  """Testpolicytemplaterequest model"""


class TestpolicytemplaterequestResponse(APIResponse):
  """Response model for Testpolicytemplaterequest"""

  data: Optional[Testpolicytemplaterequest] = None


class TestpolicytemplaterequestListResponse(APIResponse):
  """List response model for Testpolicytemplaterequest"""

  data: List[Testpolicytemplaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
