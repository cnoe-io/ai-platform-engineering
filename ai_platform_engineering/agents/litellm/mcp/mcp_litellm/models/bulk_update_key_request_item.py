"""Model for Bulkupdatekeyrequestitem"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Bulkupdatekeyrequestitem(BaseModel):
  """Individual key update request item"""


class BulkupdatekeyrequestitemResponse(APIResponse):
  """Response model for Bulkupdatekeyrequestitem"""

  data: Optional[Bulkupdatekeyrequestitem] = None


class BulkupdatekeyrequestitemListResponse(APIResponse):
  """List response model for Bulkupdatekeyrequestitem"""

  data: List[Bulkupdatekeyrequestitem] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
