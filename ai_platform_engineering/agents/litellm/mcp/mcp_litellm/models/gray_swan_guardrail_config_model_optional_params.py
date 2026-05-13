"""Model for Grayswanguardrailconfigmodeloptionalparams"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Grayswanguardrailconfigmodeloptionalparams(BaseModel):
  """Optional parameters for the Gray Swan guardrail."""


class GrayswanguardrailconfigmodeloptionalparamsResponse(APIResponse):
  """Response model for Grayswanguardrailconfigmodeloptionalparams"""

  data: Optional[Grayswanguardrailconfigmodeloptionalparams] = None


class GrayswanguardrailconfigmodeloptionalparamsListResponse(APIResponse):
  """List response model for Grayswanguardrailconfigmodeloptionalparams"""

  data: List[Grayswanguardrailconfigmodeloptionalparams] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
