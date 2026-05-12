"""Model for Updateteamrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updateteamrequest(BaseModel):
  """UpdateTeamRequest, used by /team/update when you need to update a team

  team_id: str
  team_alias: Optional[str] = None
  organization_id: Optional[str] = None
  metadata: Optional[dict] = None
  tpm_limit: Optional[int] = None
  rpm_limit: Optional[int] = None
  max_budget: Optional[float] = None
  models: Optional[list] = None
  blocked: Optional[bool] = None
  budget_duration: Optional[str] = None
  guardrails: Optional[List[str]] = None
  policies: Optional[List[str]] = None"""


class UpdateteamrequestResponse(APIResponse):
  """Response model for Updateteamrequest"""

  data: Optional[Updateteamrequest] = None


class UpdateteamrequestListResponse(APIResponse):
  """List response model for Updateteamrequest"""

  data: List[Updateteamrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
