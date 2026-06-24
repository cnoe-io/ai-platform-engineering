"""Model for Promptlitellmparams"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Promptlitellmparams(BaseModel):
  """Promptlitellmparams model"""


class PromptlitellmparamsResponse(APIResponse):
  """Response model for Promptlitellmparams"""

  data: Optional[Promptlitellmparams] = None


class PromptlitellmparamsListResponse(APIResponse):
  """List response model for Promptlitellmparams"""

  data: List[Promptlitellmparams] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
