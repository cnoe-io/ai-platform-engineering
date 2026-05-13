"""Model for Updateguardrailrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updateguardrailrequest(BaseModel):
  """Updateguardrailrequest model"""


class UpdateguardrailrequestResponse(APIResponse):
  """Response model for Updateguardrailrequest"""

  data: Optional[Updateguardrailrequest] = None


class UpdateguardrailrequestListResponse(APIResponse):
  """List response model for Updateguardrailrequest"""

  data: List[Updateguardrailrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
