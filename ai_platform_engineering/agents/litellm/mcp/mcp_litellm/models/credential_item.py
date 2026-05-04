"""Model for Credentialitem"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Credentialitem(BaseModel):
  """Credentialitem model"""


class CredentialitemResponse(APIResponse):
  """Response model for Credentialitem"""

  data: Optional[Credentialitem] = None


class CredentialitemListResponse(APIResponse):
  """List response model for Credentialitem"""

  data: List[Credentialitem] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
