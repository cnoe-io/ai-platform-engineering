"""Model for Keymanagementroutes"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Keymanagementroutes(BaseModel):
  """Enum for key management routes"""


class KeymanagementroutesResponse(APIResponse):
  """Response model for Keymanagementroutes"""

  data: Optional[Keymanagementroutes] = None


class KeymanagementroutesListResponse(APIResponse):
  """List response model for Keymanagementroutes"""

  data: List[Keymanagementroutes] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
