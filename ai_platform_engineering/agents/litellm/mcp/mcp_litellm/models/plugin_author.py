"""Model for Pluginauthor"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Pluginauthor(BaseModel):
  """Plugin author information."""


class PluginauthorResponse(APIResponse):
  """Response model for Pluginauthor"""

  data: Optional[Pluginauthor] = None


class PluginauthorListResponse(APIResponse):
  """List response model for Pluginauthor"""

  data: List[Pluginauthor] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
