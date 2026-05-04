"""Model for Testcustomcodeguardrailrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Testcustomcodeguardrailrequest(BaseModel):
  """Request model for testing custom code guardrails."""


class TestcustomcodeguardrailrequestResponse(APIResponse):
  """Response model for Testcustomcodeguardrailrequest"""

  data: Optional[Testcustomcodeguardrailrequest] = None


class TestcustomcodeguardrailrequestListResponse(APIResponse):
  """List response model for Testcustomcodeguardrailrequest"""

  data: List[Testcustomcodeguardrailrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
