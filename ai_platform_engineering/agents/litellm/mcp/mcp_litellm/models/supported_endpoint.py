"""Model for Supportedendpoint"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Supportedendpoint(BaseModel):
  """Supportedendpoint model"""


class SupportedendpointResponse(APIResponse):
  """Response model for Supportedendpoint"""

  data: Optional[Supportedendpoint] = None


class SupportedendpointListResponse(APIResponse):
  """List response model for Supportedendpoint"""

  data: List[Supportedendpoint] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
