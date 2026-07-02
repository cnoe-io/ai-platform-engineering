"""Model for Cloudzerosettingsupdate"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Cloudzerosettingsupdate(BaseModel):
  """Request model for updating CloudZero settings"""


class CloudzerosettingsupdateResponse(APIResponse):
  """Response model for Cloudzerosettingsupdate"""

  data: Optional[Cloudzerosettingsupdate] = None


class CloudzerosettingsupdateListResponse(APIResponse):
  """List response model for Cloudzerosettingsupdate"""

  data: List[Cloudzerosettingsupdate] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
