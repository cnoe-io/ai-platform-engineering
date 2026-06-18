"""Model for Policyversioncreaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Policyversioncreaterequest(BaseModel):
  """Request body for creating a new policy version (draft)."""


class PolicyversioncreaterequestResponse(APIResponse):
  """Response model for Policyversioncreaterequest"""

  data: Optional[Policyversioncreaterequest] = None


class PolicyversioncreaterequestListResponse(APIResponse):
  """List response model for Policyversioncreaterequest"""

  data: List[Policyversioncreaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
