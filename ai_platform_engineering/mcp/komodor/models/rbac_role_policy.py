"""Model for Rbacrolepolicy"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rbacrolepolicy(BaseModel):
  """Rbacrolepolicy model"""


class RbacrolepolicyResponse(APIResponse):
  """Response model for Rbacrolepolicy"""

  data: Optional[Rbacrolepolicy] = None


class RbacrolepolicyListResponse(APIResponse):
  """List response model for Rbacrolepolicy"""

  data: List[Rbacrolepolicy] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
