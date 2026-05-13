"""Model for Mcpusercredentialrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mcpusercredentialrequest(BaseModel):
  """Mcpusercredentialrequest model"""


class McpusercredentialrequestResponse(APIResponse):
  """Response model for Mcpusercredentialrequest"""

  data: Optional[Mcpusercredentialrequest] = None


class McpusercredentialrequestListResponse(APIResponse):
  """List response model for Mcpusercredentialrequest"""

  data: List[Mcpusercredentialrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
