"""Model for Guardrail"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Guardrail(BaseModel):
  """Guardrail model"""


class GuardrailResponse(APIResponse):
  """Response model for Guardrail"""

  data: Optional[Guardrail] = None


class GuardrailListResponse(APIResponse):
  """List response model for Guardrail"""

  data: List[Guardrail] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
