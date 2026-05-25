"""Model for Validationerror"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Validationerror(BaseModel):
  """Validationerror model"""


class ValidationerrorResponse(APIResponse):
  """Response model for Validationerror"""

  data: Optional[Validationerror] = None


class ValidationerrorListResponse(APIResponse):
  """List response model for Validationerror"""

  data: List[Validationerror] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
