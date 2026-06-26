"""Model for Configurationsensor"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Configurationsensor(BaseModel):
  """Configurationsensor model"""


class ConfigurationsensorResponse(APIResponse):
  """Response model for Configurationsensor"""

  data: Optional[Configurationsensor] = None


class ConfigurationsensorListResponse(APIResponse):
  """List response model for Configurationsensor"""

  data: List[Configurationsensor] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
