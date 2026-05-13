"""Model for Spendanalyticspaginatedresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Spendanalyticspaginatedresponse(BaseModel):
  """Spendanalyticspaginatedresponse model"""


class SpendanalyticspaginatedresponseResponse(APIResponse):
  """Response model for Spendanalyticspaginatedresponse"""

  data: Optional[Spendanalyticspaginatedresponse] = None


class SpendanalyticspaginatedresponseListResponse(APIResponse):
  """List response model for Spendanalyticspaginatedresponse"""

  data: List[Spendanalyticspaginatedresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
