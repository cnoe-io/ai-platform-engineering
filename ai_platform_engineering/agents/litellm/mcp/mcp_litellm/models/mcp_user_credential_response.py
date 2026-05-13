"""Model for Mcpusercredentialresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mcpusercredentialresponse(BaseModel):
  """Mcpusercredentialresponse model"""


class McpusercredentialresponseResponse(APIResponse):
  """Response model for Mcpusercredentialresponse"""

  data: Optional[Mcpusercredentialresponse] = None


class McpusercredentialresponseListResponse(APIResponse):
  """List response model for Mcpusercredentialresponse"""

  data: List[Mcpusercredentialresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
