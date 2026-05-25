"""Model for Mcptoolsettool"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mcptoolsettool(BaseModel):
  """Mcptoolsettool model"""


class McptoolsettoolResponse(APIResponse):
  """Response model for Mcptoolsettool"""

  data: Optional[Mcptoolsettool] = None


class McptoolsettoolListResponse(APIResponse):
  """List response model for Mcptoolsettool"""

  data: List[Mcptoolsettool] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
