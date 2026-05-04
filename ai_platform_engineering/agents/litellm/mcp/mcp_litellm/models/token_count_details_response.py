"""Model for Tokencountdetailsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Tokencountdetailsresponse(BaseModel):
  """Response structure for token count details with modality breakdown.

  Example:
      {'totalTokens': 12, 'promptTokensDetails': [{'modality': 'TEXT', 'tokenCount': 12}]}"""


class TokencountdetailsresponseResponse(APIResponse):
  """Response model for Tokencountdetailsresponse"""

  data: Optional[Tokencountdetailsresponse] = None


class TokencountdetailsresponseListResponse(APIResponse):
  """List response model for Tokencountdetailsresponse"""

  data: List[Tokencountdetailsresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
