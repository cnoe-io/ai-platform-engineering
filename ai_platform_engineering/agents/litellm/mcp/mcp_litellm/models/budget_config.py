"""Model for Budgetconfig"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Budgetconfig(BaseModel):
  """Budgetconfig model"""


class BudgetconfigResponse(APIResponse):
  """Response model for Budgetconfig"""

  data: Optional[Budgetconfig] = None


class BudgetconfigListResponse(APIResponse):
  """List response model for Budgetconfig"""

  data: List[Budgetconfig] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
