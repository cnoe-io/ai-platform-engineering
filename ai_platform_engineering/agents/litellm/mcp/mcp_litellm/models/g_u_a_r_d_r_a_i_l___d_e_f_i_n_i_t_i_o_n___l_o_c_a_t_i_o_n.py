"""Model for GuardrailDefinitionLocation"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class GuardrailDefinitionLocation(BaseModel):
  """GuardrailDefinitionLocation model"""


class GuardrailDefinitionLocationResponse(APIResponse):
  """Response model for GuardrailDefinitionLocation"""

  data: Optional[GuardrailDefinitionLocation] = None


class GuardrailDefinitionLocationListResponse(APIResponse):
  """List response model for GuardrailDefinitionLocation"""

  data: List[GuardrailDefinitionLocation] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
