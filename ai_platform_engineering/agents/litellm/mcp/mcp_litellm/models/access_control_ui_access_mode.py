"""Model for AccesscontrolUiAccessmode"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class AccesscontrolUiAccessmode(BaseModel):
  """Model for Controlling UI Access Mode via SSO Groups"""


class AccesscontrolUiAccessmodeResponse(APIResponse):
  """Response model for AccesscontrolUiAccessmode"""

  data: Optional[AccesscontrolUiAccessmode] = None


class AccesscontrolUiAccessmodeListResponse(APIResponse):
  """List response model for AccesscontrolUiAccessmode"""

  data: List[AccesscontrolUiAccessmode] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
