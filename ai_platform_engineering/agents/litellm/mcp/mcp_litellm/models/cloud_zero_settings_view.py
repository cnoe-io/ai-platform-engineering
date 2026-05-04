"""Model for Cloudzerosettingsview"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cloudzerosettingsview(BaseModel):
  """Response model for viewing CloudZero settings with masked API key"""


class CloudzerosettingsviewResponse(APIResponse):
  """Response model for Cloudzerosettingsview"""

  data: Optional[Cloudzerosettingsview] = None


class CloudzerosettingsviewListResponse(APIResponse):
  """List response model for Cloudzerosettingsview"""

  data: List[Cloudzerosettingsview] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
