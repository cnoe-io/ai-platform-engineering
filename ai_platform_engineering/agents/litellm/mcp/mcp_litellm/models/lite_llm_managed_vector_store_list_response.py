"""Model for LitellmManagedvectorstorelistresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmManagedvectorstorelistresponse(BaseModel):
  """Response format for listing vector stores"""


class LitellmManagedvectorstorelistresponseResponse(APIResponse):
  """Response model for LitellmManagedvectorstorelistresponse"""

  data: Optional[LitellmManagedvectorstorelistresponse] = None


class LitellmManagedvectorstorelistresponseListResponse(APIResponse):
  """List response model for LitellmManagedvectorstorelistresponse"""

  data: List[LitellmManagedvectorstorelistresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
