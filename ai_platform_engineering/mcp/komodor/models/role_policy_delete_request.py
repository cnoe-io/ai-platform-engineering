"""Model for Rolepolicydeleterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rolepolicydeleterequest(BaseModel):
  """Rolepolicydeleterequest model"""


class RolepolicydeleterequestResponse(APIResponse):
  """Response model for Rolepolicydeleterequest"""

  data: Optional[Rolepolicydeleterequest] = None


class RolepolicydeleterequestListResponse(APIResponse):
  """List response model for Rolepolicydeleterequest"""

  data: List[Rolepolicydeleterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
