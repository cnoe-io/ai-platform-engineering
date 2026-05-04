"""Model for Mcpsemanticfiltersettings"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mcpsemanticfiltersettings(BaseModel):
  """Configuration for MCP Semantic Tool Filter"""


class McpsemanticfiltersettingsResponse(APIResponse):
  """Response model for Mcpsemanticfiltersettings"""

  data: Optional[Mcpsemanticfiltersettings] = None


class McpsemanticfiltersettingsListResponse(APIResponse):
  """List response model for Mcpsemanticfiltersettings"""

  data: List[Mcpsemanticfiltersettings] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
