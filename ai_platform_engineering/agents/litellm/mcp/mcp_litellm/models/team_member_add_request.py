"""Model for Teammemberaddrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Teammemberaddrequest(BaseModel):
  """Request body for adding members to a team.

  Example:
  ```json
  {
      "team_id": "45e3e396-ee08-4a61-a88e-16b3ce7e0849",
      "member": {
          "role": "user",
          "user_id": "user123"
      },
      "max_budget_in_team": 100.0
  }
  ```"""


class TeammemberaddrequestResponse(APIResponse):
  """Response model for Teammemberaddrequest"""

  data: Optional[Teammemberaddrequest] = None


class TeammemberaddrequestListResponse(APIResponse):
  """List response model for Teammemberaddrequest"""

  data: List[Teammemberaddrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
