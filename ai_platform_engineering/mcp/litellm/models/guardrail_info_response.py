"""Model for Guardrailinforesponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Guardrailinforesponse(BaseModel):
  """Guardrailinforesponse model"""


class GuardrailinforesponseResponse(APIResponse):
  """Response model for Guardrailinforesponse"""

  data: Optional[Guardrailinforesponse] = None


class GuardrailinforesponseListResponse(APIResponse):
  """List response model for Guardrailinforesponse"""

  data: List[Guardrailinforesponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
