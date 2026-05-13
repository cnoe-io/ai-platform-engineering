"""Model for Toolpolicyupdaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Toolpolicyupdaterequest(BaseModel):
  """Toolpolicyupdaterequest model"""


class ToolpolicyupdaterequestResponse(APIResponse):
  """Response model for Toolpolicyupdaterequest"""

  data: Optional[Toolpolicyupdaterequest] = None


class ToolpolicyupdaterequestListResponse(APIResponse):
  """List response model for Toolpolicyupdaterequest"""

  data: List[Toolpolicyupdaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
