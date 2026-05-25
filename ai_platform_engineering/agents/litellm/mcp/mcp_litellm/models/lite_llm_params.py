"""Model for LitellmParams"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmParams(BaseModel):
  """LiteLLM Params with 'model' requirement - used for completions"""


class LitellmParamsResponse(APIResponse):
  """Response model for LitellmParams"""

  data: Optional[LitellmParams] = None


class LitellmParamsListResponse(APIResponse):
  """List response model for LitellmParams"""

  data: List[LitellmParams] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
