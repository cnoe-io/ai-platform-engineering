"""Model for Transformrequestbody"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Transformrequestbody(BaseModel):
  """Transformrequestbody model"""


class TransformrequestbodyResponse(APIResponse):
  """Response model for Transformrequestbody"""

  data: Optional[Transformrequestbody] = None


class TransformrequestbodyListResponse(APIResponse):
  """List response model for Transformrequestbody"""

  data: List[Transformrequestbody] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
