"""Model for Workerregistryentry"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Workerregistryentry(BaseModel):
  """Workerregistryentry model"""


class WorkerregistryentryResponse(APIResponse):
  """Response model for Workerregistryentry"""

  data: Optional[Workerregistryentry] = None


class WorkerregistryentryListResponse(APIResponse):
  """List response model for Workerregistryentry"""

  data: List[Workerregistryentry] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
