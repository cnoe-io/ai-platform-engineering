"""Model for Loggingcallbackstatus"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Loggingcallbackstatus(BaseModel):
  """Loggingcallbackstatus model"""


class LoggingcallbackstatusResponse(APIResponse):
  """Response model for Loggingcallbackstatus"""

  data: Optional[Loggingcallbackstatus] = None


class LoggingcallbackstatusListResponse(APIResponse):
  """List response model for Loggingcallbackstatus"""

  data: List[Loggingcallbackstatus] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
