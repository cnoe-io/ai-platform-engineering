"""Model for Toolpermissionrule"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Toolpermissionrule(BaseModel):
  """A rule defining permission for a specific tool or tool pattern"""


class ToolpermissionruleResponse(APIResponse):
  """Response model for Toolpermissionrule"""

  data: Optional[Toolpermissionrule] = None


class ToolpermissionruleListResponse(APIResponse):
  """List response model for Toolpermissionrule"""

  data: List[Toolpermissionrule] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
