"""Model for Issuereasoncategory"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Issuereasoncategory(BaseModel):
  """Categories for reasons related to issues with containers, pods, and deployments."""


class IssuereasoncategoryResponse(APIResponse):
  """Response model for Issuereasoncategory"""

  data: Optional[Issuereasoncategory] = None


class IssuereasoncategoryListResponse(APIResponse):
  """List response model for Issuereasoncategory"""

  data: List[Issuereasoncategory] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
