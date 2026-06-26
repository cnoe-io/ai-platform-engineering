"""Model for Guardrailsubmissionitem"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Guardrailsubmissionitem(BaseModel):
  """Guardrailsubmissionitem model"""


class GuardrailsubmissionitemResponse(APIResponse):
  """Response model for Guardrailsubmissionitem"""

  data: Optional[Guardrailsubmissionitem] = None


class GuardrailsubmissionitemListResponse(APIResponse):
  """List response model for Guardrailsubmissionitem"""

  data: List[Guardrailsubmissionitem] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
