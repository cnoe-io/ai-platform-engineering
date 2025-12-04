"""Model for Issuespropswrapper"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Issuespropswrapper(BaseModel):
  """Issuespropswrapper model"""


class IssuespropswrapperResponse(APIResponse):
  """Response model for Issuespropswrapper"""

  data: Optional[Issuespropswrapper] = None


class IssuespropswrapperListResponse(APIResponse):
  """List response model for Issuespropswrapper"""

  data: List[Issuespropswrapper] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
