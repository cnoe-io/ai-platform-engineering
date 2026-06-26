"""Model for Rbacuserrole"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rbacuserrole(BaseModel):
  """Rbacuserrole model"""


class RbacuserroleResponse(APIResponse):
  """Response model for Rbacuserrole"""

  data: Optional[Rbacuserrole] = None


class RbacuserroleListResponse(APIResponse):
  """List response model for Rbacuserrole"""

  data: List[Rbacuserrole] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
