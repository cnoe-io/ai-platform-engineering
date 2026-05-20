"""Model for LitellmVerificationtoken"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmVerificationtoken(BaseModel):
  """LitellmVerificationtoken model"""


class LitellmVerificationtokenResponse(APIResponse):
  """Response model for LitellmVerificationtoken"""

  data: Optional[LitellmVerificationtoken] = None


class LitellmVerificationtokenListResponse(APIResponse):
  """List response model for LitellmVerificationtoken"""

  data: List[LitellmVerificationtoken] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
