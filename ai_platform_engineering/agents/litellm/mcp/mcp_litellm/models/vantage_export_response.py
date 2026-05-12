"""Model for Vantageexportresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Vantageexportresponse(BaseModel):
  """Response model for Vantage export operations"""


class VantageexportresponseResponse(APIResponse):
  """Response model for Vantageexportresponse"""

  data: Optional[Vantageexportresponse] = None


class VantageexportresponseListResponse(APIResponse):
  """List response model for Vantageexportresponse"""

  data: List[Vantageexportresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
