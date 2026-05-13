"""Model for Eval"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Eval(BaseModel):
  """Represents an evaluation from the OpenAI Evals API"""


class EvalResponse(APIResponse):
  """Response model for Eval"""

  data: Optional[Eval] = None


class EvalListResponse(APIResponse):
  """List response model for Eval"""

  data: List[Eval] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
