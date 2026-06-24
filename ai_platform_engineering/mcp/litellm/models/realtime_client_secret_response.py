"""Model for Realtimeclientsecretresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Realtimeclientsecretresponse(BaseModel):
  """Response from POST /v1/realtime/client_secrets.

  Both the top-level `value` and `session.client_secret.value`
  will contain the encrypted token instead of the raw ephemeral key.
  The `session` field is kept as a raw dict so unknown fields pass through."""


class RealtimeclientsecretresponseResponse(APIResponse):
  """Response model for Realtimeclientsecretresponse"""

  data: Optional[Realtimeclientsecretresponse] = None


class RealtimeclientsecretresponseListResponse(APIResponse):
  """List response model for Realtimeclientsecretresponse"""

  data: List[Realtimeclientsecretresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
