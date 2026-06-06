"""Model for Genericguardrailapiinputs"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Genericguardrailapiinputs(BaseModel):
  """Genericguardrailapiinputs model"""


class GenericguardrailapiinputsResponse(APIResponse):
  """Response model for Genericguardrailapiinputs"""

  data: Optional[Genericguardrailapiinputs] = None


class GenericguardrailapiinputsListResponse(APIResponse):
  """List response model for Genericguardrailapiinputs"""

  data: List[Genericguardrailapiinputs] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
