"""Model for Submitbulkactionsrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Submitbulkactionsrequest(BaseModel):
  """Submitbulkactionsrequest model"""


class SubmitbulkactionsrequestResponse(APIResponse):
  """Response model for Submitbulkactionsrequest"""

  data: Optional[Submitbulkactionsrequest] = None


class SubmitbulkactionsrequestListResponse(APIResponse):
  """List response model for Submitbulkactionsrequest"""

  data: List[Submitbulkactionsrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
