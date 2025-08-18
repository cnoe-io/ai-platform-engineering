"""Model for Rbacpolicyaction"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rbacpolicyaction(BaseModel):
    """Rbacpolicyaction model"""


class RbacpolicyactionResponse(APIResponse):
    """Response model for Rbacpolicyaction"""

    data: Optional[Rbacpolicyaction] = None


class RbacpolicyactionListResponse(APIResponse):
    """List response model for Rbacpolicyaction"""

    data: List[Rbacpolicyaction] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
