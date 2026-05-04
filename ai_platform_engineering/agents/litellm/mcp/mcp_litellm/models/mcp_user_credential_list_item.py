"""Model for Mcpusercredentiallistitem"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mcpusercredentiallistitem(BaseModel):
  """One entry in the /user-credentials list."""


class McpusercredentiallistitemResponse(APIResponse):
  """Response model for Mcpusercredentiallistitem"""

  data: Optional[Mcpusercredentiallistitem] = None


class McpusercredentiallistitemListResponse(APIResponse):
  """List response model for Mcpusercredentiallistitem"""

  data: List[Mcpusercredentiallistitem] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
