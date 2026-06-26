"""Model for Rbacrolepolicycreaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rbacrolepolicycreaterequest(BaseModel):
  """Rbacrolepolicycreaterequest model"""


class RbacrolepolicycreaterequestResponse(APIResponse):
  """Response model for Rbacrolepolicycreaterequest"""

  data: Optional[Rbacrolepolicycreaterequest] = None


class RbacrolepolicycreaterequestListResponse(APIResponse):
  """List response model for Rbacrolepolicycreaterequest"""

  data: List[Rbacrolepolicycreaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
