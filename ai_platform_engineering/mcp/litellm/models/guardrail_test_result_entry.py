"""Model for Guardrailtestresultentry"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Guardrailtestresultentry(BaseModel):
  """Guardrailtestresultentry model"""


class GuardrailtestresultentryResponse(APIResponse):
  """Response model for Guardrailtestresultentry"""

  data: Optional[Guardrailtestresultentry] = None


class GuardrailtestresultentryListResponse(APIResponse):
  """List response model for Guardrailtestresultentry"""

  data: List[Guardrailtestresultentry] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
