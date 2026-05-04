"""Model for Budgetdeleterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Budgetdeleterequest(BaseModel):
  """Budgetdeleterequest model"""


class BudgetdeleterequestResponse(APIResponse):
  """Response model for Budgetdeleterequest"""

  data: Optional[Budgetdeleterequest] = None


class BudgetdeleterequestListResponse(APIResponse):
  """List response model for Budgetdeleterequest"""

  data: List[Budgetdeleterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
