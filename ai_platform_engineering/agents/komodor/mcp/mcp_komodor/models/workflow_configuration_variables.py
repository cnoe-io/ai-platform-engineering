"""Model for Workflowconfigurationvariables"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Workflowconfigurationvariables(BaseModel):
    """Workflowconfigurationvariables model"""


class WorkflowconfigurationvariablesResponse(APIResponse):
    """Response model for Workflowconfigurationvariables"""

    data: Optional[Workflowconfigurationvariables] = None


class WorkflowconfigurationvariablesListResponse(APIResponse):
    """List response model for Workflowconfigurationvariables"""

    data: List[Workflowconfigurationvariables] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
