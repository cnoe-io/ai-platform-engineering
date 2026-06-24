"""Model for Testcustomcodeguardrailresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Testcustomcodeguardrailresponse(BaseModel):
  """Response model for testing custom code guardrails."""


class TestcustomcodeguardrailresponseResponse(APIResponse):
  """Response model for Testcustomcodeguardrailresponse"""

  data: Optional[Testcustomcodeguardrailresponse] = None


class TestcustomcodeguardrailresponseListResponse(APIResponse):
  """List response model for Testcustomcodeguardrailresponse"""

  data: List[Testcustomcodeguardrailresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
