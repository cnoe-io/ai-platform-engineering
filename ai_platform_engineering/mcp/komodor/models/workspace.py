"""Model for Workspace"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Workspace(BaseModel):
  """Workspace model"""


class WorkspaceResponse(APIResponse):
  """Response model for Workspace"""

  data: Optional[Workspace] = None


class WorkspaceListResponse(APIResponse):
  """List response model for Workspace"""

  data: List[Workspace] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
