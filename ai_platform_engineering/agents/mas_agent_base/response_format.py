"""Standard response format for agents."""

from pydantic import BaseModel, Field


class ResponseFormat(BaseModel):
    """Format for structured agent responses."""

    status: str = Field(description="Response status: 'completed', 'input_required', or 'error'")
    message: str = Field(description="The response message to the user")
