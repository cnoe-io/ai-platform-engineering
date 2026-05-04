"""Model for Budgetrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Budgetrequest(BaseModel):
  """Budgetrequest model"""


class BudgetrequestResponse(APIResponse):
  """Response model for Budgetrequest"""

  data: Optional[Budgetrequest] = None


class BudgetrequestListResponse(APIResponse):
  """List response model for Budgetrequest"""

  data: List[Budgetrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
