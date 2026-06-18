"""Model for Bulkupdatekeyresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Bulkupdatekeyresponse(BaseModel):
  """Response for bulk key update operations"""


class BulkupdatekeyresponseResponse(APIResponse):
  """Response model for Bulkupdatekeyresponse"""

  data: Optional[Bulkupdatekeyresponse] = None


class BulkupdatekeyresponseListResponse(APIResponse):
  """List response model for Bulkupdatekeyresponse"""

  data: List[Bulkupdatekeyresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
