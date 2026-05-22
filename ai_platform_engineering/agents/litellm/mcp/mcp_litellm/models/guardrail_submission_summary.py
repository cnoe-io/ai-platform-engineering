"""Model for Guardrailsubmissionsummary"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Guardrailsubmissionsummary(BaseModel):
  """Guardrailsubmissionsummary model"""


class GuardrailsubmissionsummaryResponse(APIResponse):
  """Response model for Guardrailsubmissionsummary"""

  data: Optional[Guardrailsubmissionsummary] = None


class GuardrailsubmissionsummaryListResponse(APIResponse):
  """List response model for Guardrailsubmissionsummary"""

  data: List[Guardrailsubmissionsummary] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
