"""Model for Customeventdto"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Customeventdto(BaseModel):
  """Customeventdto model"""


class CustomeventdtoResponse(APIResponse):
  """Response model for Customeventdto"""

  data: Optional[Customeventdto] = None


class CustomeventdtoListResponse(APIResponse):
  """List response model for Customeventdto"""

  data: List[Customeventdto] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
