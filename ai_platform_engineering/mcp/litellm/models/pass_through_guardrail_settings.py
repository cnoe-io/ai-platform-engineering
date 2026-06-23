"""Model for Passthroughguardrailsettings"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Passthroughguardrailsettings(BaseModel):
  """Settings for a specific guardrail on a passthrough endpoint.

  Allows field-level targeting for guardrail execution."""


class PassthroughguardrailsettingsResponse(APIResponse):
  """Response model for Passthroughguardrailsettings"""

  data: Optional[Passthroughguardrailsettings] = None


class PassthroughguardrailsettingsListResponse(APIResponse):
  """List response model for Passthroughguardrailsettings"""

  data: List[Passthroughguardrailsettings] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
