"""Model for Budgetlimitentry"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Budgetlimitentry(BaseModel):
  """A single budget window with its own limit and independent reset schedule."""


class BudgetlimitentryResponse(APIResponse):
  """Response model for Budgetlimitentry"""

  data: Optional[Budgetlimitentry] = None


class BudgetlimitentryListResponse(APIResponse):
  """List response model for Budgetlimitentry"""

  data: List[Budgetlimitentry] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
