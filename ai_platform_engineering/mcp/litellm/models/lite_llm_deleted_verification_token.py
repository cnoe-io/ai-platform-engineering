"""Model for LitellmDeletedverificationtoken"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmDeletedverificationtoken(BaseModel):
  """Recording of deleted keys for audit purposes. Mirrors LiteLLM_VerificationToken
  plus metadata captured at deletion time."""


class LitellmDeletedverificationtokenResponse(APIResponse):
  """Response model for LitellmDeletedverificationtoken"""

  data: Optional[LitellmDeletedverificationtoken] = None


class LitellmDeletedverificationtokenListResponse(APIResponse):
  """List response model for LitellmDeletedverificationtoken"""

  data: List[LitellmDeletedverificationtoken] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
