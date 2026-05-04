"""Model for LitellmBudgettable"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmBudgettable(BaseModel):
  """Represents user-controllable params for a LiteLLM_BudgetTable record"""


class LitellmBudgettableResponse(APIResponse):
  """Response model for LitellmBudgettable"""

  data: Optional[LitellmBudgettable] = None


class LitellmBudgettableListResponse(APIResponse):
  """List response model for LitellmBudgettable"""

  data: List[LitellmBudgettable] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
