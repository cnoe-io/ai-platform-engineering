"""Model for Configurationvariables"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Configurationvariables(BaseModel):
  """Configurationvariables model"""


class ConfigurationvariablesResponse(APIResponse):
  """Response model for Configurationvariables"""

  data: Optional[Configurationvariables] = None


class ConfigurationvariablesListResponse(APIResponse):
  """List response model for Configurationvariables"""

  data: List[Configurationvariables] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
