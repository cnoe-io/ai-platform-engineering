"""Model for Proxychatcompletionrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Proxychatcompletionrequest(BaseModel):
  """Pydantic model for chat completion requests that includes both OpenAI standard fields
  and LiteLLM-specific parameters. This replaces the previous TypedDict version."""


class ProxychatcompletionrequestResponse(APIResponse):
  """Response model for Proxychatcompletionrequest"""

  data: Optional[Proxychatcompletionrequest] = None


class ProxychatcompletionrequestListResponse(APIResponse):
  """List response model for Proxychatcompletionrequest"""

  data: List[Proxychatcompletionrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
