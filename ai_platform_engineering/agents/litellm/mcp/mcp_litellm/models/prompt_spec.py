"""Model for Promptspec"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Promptspec(BaseModel):
  """Promptspec model"""


class PromptspecResponse(APIResponse):
  """Response model for Promptspec"""

  data: Optional[Promptspec] = None


class PromptspecListResponse(APIResponse):
  """List response model for Promptspec"""

  data: List[Promptspec] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
