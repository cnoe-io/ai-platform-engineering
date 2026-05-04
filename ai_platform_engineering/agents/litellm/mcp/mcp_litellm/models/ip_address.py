"""Model for Ipaddress"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Ipaddress(BaseModel):
  """Ipaddress model"""


class IpaddressResponse(APIResponse):
  """Response model for Ipaddress"""

  data: Optional[Ipaddress] = None


class IpaddressListResponse(APIResponse):
  """List response model for Ipaddress"""

  data: List[Ipaddress] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
