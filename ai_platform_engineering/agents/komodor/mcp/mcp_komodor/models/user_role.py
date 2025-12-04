"""Model for Userrole"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Userrole(BaseModel):
  """Userrole model"""


class UserroleResponse(APIResponse):
  """Response model for Userrole"""

  data: Optional[Userrole] = None


class UserroleListResponse(APIResponse):
  """List response model for Userrole"""

  data: List[Userrole] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
