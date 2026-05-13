"""Model for LitellmDeletedteamtable"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmDeletedteamtable(BaseModel):
  """Recording of deleted teams for audit purposes. Mirrors LiteLLM_TeamTable
  plus metadata captured at deletion time."""


class LitellmDeletedteamtableResponse(APIResponse):
  """Response model for LitellmDeletedteamtable"""

  data: Optional[LitellmDeletedteamtable] = None


class LitellmDeletedteamtableListResponse(APIResponse):
  """List response model for LitellmDeletedteamtable"""

  data: List[LitellmDeletedteamtable] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
