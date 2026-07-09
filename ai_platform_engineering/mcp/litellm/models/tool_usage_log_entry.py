"""Model for Toolusagelogentry"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Toolusagelogentry(BaseModel):
  """One spend log row for a tool call (for UI "recent logs" table)."""


class ToolusagelogentryResponse(APIResponse):
  """Response model for Toolusagelogentry"""

  data: Optional[Toolusagelogentry] = None


class ToolusagelogentryListResponse(APIResponse):
  """List response model for Toolusagelogentry"""

  data: List[Toolusagelogentry] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
