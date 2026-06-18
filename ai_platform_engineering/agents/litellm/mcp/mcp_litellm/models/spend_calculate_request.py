"""Model for Spendcalculaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Spendcalculaterequest(BaseModel):
  """Spendcalculaterequest model"""


class SpendcalculaterequestResponse(APIResponse):
  """Response model for Spendcalculaterequest"""

  data: Optional[Spendcalculaterequest] = None


class SpendcalculaterequestListResponse(APIResponse):
  """List response model for Spendcalculaterequest"""

  data: List[Spendcalculaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
