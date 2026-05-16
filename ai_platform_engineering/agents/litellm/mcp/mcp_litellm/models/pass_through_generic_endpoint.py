"""Model for Passthroughgenericendpoint"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Passthroughgenericendpoint(BaseModel):
  """Passthroughgenericendpoint model"""


class PassthroughgenericendpointResponse(APIResponse):
  """Response model for Passthroughgenericendpoint"""

  data: Optional[Passthroughgenericendpoint] = None


class PassthroughgenericendpointListResponse(APIResponse):
  """List response model for Passthroughgenericendpoint"""

  data: List[Passthroughgenericendpoint] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
