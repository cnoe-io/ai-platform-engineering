"""Model for Mcppublicserver"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mcppublicserver(BaseModel):
  """Safe params for public MCP servers"""


class McppublicserverResponse(APIResponse):
  """Response model for Mcppublicserver"""

  data: Optional[Mcppublicserver] = None


class McppublicserverListResponse(APIResponse):
  """List response model for Mcppublicserver"""

  data: List[Mcppublicserver] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
