"""Model for Makemcpserverspublicrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Makemcpserverspublicrequest(BaseModel):
  """Makemcpserverspublicrequest model"""


class MakemcpserverspublicrequestResponse(APIResponse):
  """Response model for Makemcpserverspublicrequest"""

  data: Optional[Makemcpserverspublicrequest] = None


class MakemcpserverspublicrequestListResponse(APIResponse):
  """List response model for Makemcpserverspublicrequest"""

  data: List[Makemcpserverspublicrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
