"""Model for Endpointprovider"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Endpointprovider(BaseModel):
  """Endpointprovider model"""


class EndpointproviderResponse(APIResponse):
  """Response model for Endpointprovider"""

  data: Optional[Endpointprovider] = None


class EndpointproviderListResponse(APIResponse):
  """List response model for Endpointprovider"""

  data: List[Endpointprovider] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
