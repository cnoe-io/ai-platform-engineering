"""Model for Hashicorpvaultconfig"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Hashicorpvaultconfig(BaseModel):
  """Configuration for Hashicorp Vault secret manager integration."""


class HashicorpvaultconfigResponse(APIResponse):
  """Response model for Hashicorpvaultconfig"""

  data: Optional[Hashicorpvaultconfig] = None


class HashicorpvaultconfigListResponse(APIResponse):
  """List response model for Hashicorpvaultconfig"""

  data: List[Hashicorpvaultconfig] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
