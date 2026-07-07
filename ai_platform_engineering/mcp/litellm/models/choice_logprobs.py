"""Model for Choicelogprobs"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Choicelogprobs(BaseModel):
  """Choicelogprobs model"""


class ChoicelogprobsResponse(APIResponse):
  """Response model for Choicelogprobs"""

  data: Optional[Choicelogprobs] = None


class ChoicelogprobsListResponse(APIResponse):
  """List response model for Choicelogprobs"""

  data: List[Choicelogprobs] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
