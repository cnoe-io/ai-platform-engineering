"""Model for Skill"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Skill(BaseModel):
  """Represents a skill from the Anthropic Skills API"""


class SkillResponse(APIResponse):
  """Response model for Skill"""

  data: Optional[Skill] = None


class SkillListResponse(APIResponse):
  """List response model for Skill"""

  data: List[Skill] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
