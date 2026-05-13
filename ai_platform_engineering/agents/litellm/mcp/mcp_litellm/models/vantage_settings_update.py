"""Model for Vantagesettingsupdate"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Vantagesettingsupdate(BaseModel):
  """Request model for updating Vantage settings"""


class VantagesettingsupdateResponse(APIResponse):
  """Response model for Vantagesettingsupdate"""

  data: Optional[Vantagesettingsupdate] = None


class VantagesettingsupdateListResponse(APIResponse):
  """List response model for Vantagesettingsupdate"""

  data: List[Vantagesettingsupdate] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
