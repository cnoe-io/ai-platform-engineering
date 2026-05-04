"""Model for Scimserviceproviderconfig"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scimserviceproviderconfig(BaseModel):
  """Scimserviceproviderconfig model"""


class ScimserviceproviderconfigResponse(APIResponse):
  """Response model for Scimserviceproviderconfig"""

  data: Optional[Scimserviceproviderconfig] = None


class ScimserviceproviderconfigListResponse(APIResponse):
  """List response model for Scimserviceproviderconfig"""

  data: List[Scimserviceproviderconfig] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
