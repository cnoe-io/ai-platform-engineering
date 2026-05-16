"""Model for Pluginlistitem"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Pluginlistitem(BaseModel):
  """Plugin item in list responses."""


class PluginlistitemResponse(APIResponse):
  """Response model for Pluginlistitem"""

  data: Optional[Pluginlistitem] = None


class PluginlistitemListResponse(APIResponse):
  """List response model for Pluginlistitem"""

  data: List[Pluginlistitem] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
