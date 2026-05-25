"""Model for Prompt"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Prompt(BaseModel):
  """Prompt model"""


class PromptResponse(APIResponse):
  """Response model for Prompt"""

  data: Optional[Prompt] = None


class PromptListResponse(APIResponse):
  """List response model for Prompt"""

  data: List[Prompt] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
