"""Model for Allowedvectorstoreindexitem"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Allowedvectorstoreindexitem(BaseModel):
  """Allowedvectorstoreindexitem model"""


class AllowedvectorstoreindexitemResponse(APIResponse):
  """Response model for Allowedvectorstoreindexitem"""

  data: Optional[Allowedvectorstoreindexitem] = None


class AllowedvectorstoreindexitemListResponse(APIResponse):
  """List response model for Allowedvectorstoreindexitem"""

  data: List[Allowedvectorstoreindexitem] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
