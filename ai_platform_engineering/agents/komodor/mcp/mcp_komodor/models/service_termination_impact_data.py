"""Model for Serviceterminationimpactdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Serviceterminationimpactdata(BaseModel):
    """Serviceterminationimpactdata model"""


class ServiceterminationimpactdataResponse(APIResponse):
    """Response model for Serviceterminationimpactdata"""

    data: Optional[Serviceterminationimpactdata] = None


class ServiceterminationimpactdataListResponse(APIResponse):
    """List response model for Serviceterminationimpactdata"""

    data: List[Serviceterminationimpactdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
