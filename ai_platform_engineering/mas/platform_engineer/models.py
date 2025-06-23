"""Models shared between exchange components."""

from pydantic import BaseModel


class Action(BaseModel):
    """Definition of an available tool action."""

    name: str
    description: str
    jsonSchema: str
    available: str = "enabled"
