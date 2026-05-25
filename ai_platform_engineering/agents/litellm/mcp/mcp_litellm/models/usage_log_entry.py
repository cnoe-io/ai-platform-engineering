"""Model for Usagelogentry"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Usagelogentry(BaseModel):
  """Usagelogentry model"""


class UsagelogentryResponse(APIResponse):
  """Response model for Usagelogentry"""

  data: Optional[Usagelogentry] = None


class UsagelogentryListResponse(APIResponse):
  """List response model for Usagelogentry"""

  data: List[Usagelogentry] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
