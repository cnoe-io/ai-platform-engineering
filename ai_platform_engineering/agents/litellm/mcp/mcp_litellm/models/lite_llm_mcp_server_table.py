"""Model for LitellmMcpservertable"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmMcpservertable(BaseModel):
  """Represents a LiteLLM_MCPServerTable record"""


class LitellmMcpservertableResponse(APIResponse):
  """Response model for LitellmMcpservertable"""

  data: Optional[LitellmMcpservertable] = None


class LitellmMcpservertableListResponse(APIResponse):
  """List response model for LitellmMcpservertable"""

  data: List[LitellmMcpservertable] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
