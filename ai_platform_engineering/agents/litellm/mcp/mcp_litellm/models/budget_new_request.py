"""Model for Budgetnewrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Budgetnewrequest(BaseModel):
  """Budgetnewrequest model"""


class BudgetnewrequestResponse(APIResponse):
  """Response model for Budgetnewrequest"""

  data: Optional[Budgetnewrequest] = None


class BudgetnewrequestListResponse(APIResponse):
  """List response model for Budgetnewrequest"""

  data: List[Budgetnewrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
