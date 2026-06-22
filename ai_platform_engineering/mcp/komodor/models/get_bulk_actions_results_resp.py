"""Model for Getbulkactionsresultsresp"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Getbulkactionsresultsresp(BaseModel):
  """Getbulkactionsresultsresp model"""


class GetbulkactionsresultsrespResponse(APIResponse):
  """Response model for Getbulkactionsresultsresp"""

  data: Optional[Getbulkactionsresultsresp] = None


class GetbulkactionsresultsrespListResponse(APIResponse):
  """List response model for Getbulkactionsresultsresp"""

  data: List[Getbulkactionsresultsresp] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
