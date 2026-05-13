"""Model for Mcpsubmissionssummary"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mcpsubmissionssummary(BaseModel):
  """Mcpsubmissionssummary model"""


class McpsubmissionssummaryResponse(APIResponse):
  """Response model for Mcpsubmissionssummary"""

  data: Optional[Mcpsubmissionssummary] = None


class McpsubmissionssummaryListResponse(APIResponse):
  """List response model for Mcpsubmissionssummary"""

  data: List[Mcpsubmissionssummary] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
