"""Model for Rightsizingcostsummarybyservice"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rightsizingcostsummarybyservice(BaseModel):
  """Rightsizingcostsummarybyservice model"""


class RightsizingcostsummarybyserviceResponse(APIResponse):
  """Response model for Rightsizingcostsummarybyservice"""

  data: Optional[Rightsizingcostsummarybyservice] = None


class RightsizingcostsummarybyserviceListResponse(APIResponse):
  """List response model for Rightsizingcostsummarybyservice"""

  data: List[Rightsizingcostsummarybyservice] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
