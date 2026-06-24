"""Model for Mcpsemanticfiltersettingsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mcpsemanticfiltersettingsresponse(BaseModel):
  """Response model for MCP semantic filter settings"""


class McpsemanticfiltersettingsresponseResponse(APIResponse):
  """Response model for Mcpsemanticfiltersettingsresponse"""

  data: Optional[Mcpsemanticfiltersettingsresponse] = None


class McpsemanticfiltersettingsresponseListResponse(APIResponse):
  """List response model for Mcpsemanticfiltersettingsresponse"""

  data: List[Mcpsemanticfiltersettingsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
