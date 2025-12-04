"""Model for Servicestatus"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Servicestatus(BaseModel):
  """The status of the service"""


class ServicestatusResponse(APIResponse):
  """Response model for Servicestatus"""

  data: Optional[Servicestatus] = None


class ServicestatusListResponse(APIResponse):
  """List response model for Servicestatus"""

  data: List[Servicestatus] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
