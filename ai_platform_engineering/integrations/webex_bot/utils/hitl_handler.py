"""
HITL (Human-in-the-Loop) handler for Webex.

Processes Adaptive Card action submissions and maps them back to
A2A user messages for continuing the conversation flow.
"""

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from loguru import logger


@dataclass
class FormField:
    """Represents a form field."""

    field_id: str
    field_type: str  # text, select, multiselect
    label: str
    placeholder: Optional[str] = None
    options: Optional[List[Dict[str, str]]] = None
    required: bool = False
    default_value: Optional[str] = None


@dataclass
class FormAction:
    """Represents a form action button."""

    action_id: str
    label: str
    style: str = "primary"
    value: Optional[str] = None


@dataclass
class HITLForm:
    """Represents a complete HITL form."""

    form_id: str
    title: str
    description: str = ""
    fields: List[FormField] = field(default_factory=list)
    actions: List[FormAction] = field(default_factory=list)
    task_id: Optional[str] = None
    context_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


def parse_form_data(
    form_data: Dict[str, Any], task_id: str = None, context_id: str = None
) -> HITLForm:
    """Parse form data from caipe_form artifact into HITLForm."""
    form = HITLForm(
        form_id=form_data.get("form_id", f"hitl_form_{task_id or 'unknown'}"),
        title=form_data.get("title", "Action Required"),
        description=form_data.get("description", ""),
        task_id=task_id,
        context_id=context_id,
        metadata=form_data.get("metadata", {}),
    )

    for field_data in form_data.get("fields", []):
        form_field = FormField(
            field_id=field_data.get("id", field_data.get("name", "")),
            field_type=field_data.get("type", "text"),
            label=field_data.get("label", field_data.get("name", "")),
            placeholder=field_data.get("placeholder"),
            options=field_data.get("options"),
            required=field_data.get("required", False),
            default_value=field_data.get("default"),
        )
        form.fields.append(form_field)

    for action_data in form_data.get("actions", []):
        action = FormAction(
            action_id=action_data.get("id", action_data.get("name", "")),
            label=action_data.get("label", action_data.get("name", "")),
            style=action_data.get("style", "primary"),
            value=action_data.get("value"),
        )
        form.actions.append(action)

    if not form.actions:
        form.actions = [
            FormAction(action_id="approve", label="Approve", style="primary"),
            FormAction(action_id="reject", label="Reject", style="danger"),
        ]

    return form


class WebexHITLHandler:
    """Handles HITL card actions from Webex Adaptive Cards."""

    def __init__(self, a2a_client, session_manager):
        self.a2a_client = a2a_client
        self.session_manager = session_manager

    def handle_card_action(self, action_obj, webex_api) -> None:
        """Process a card action submission."""
        inputs = action_obj.inputs or {}
        action = inputs.get("action", "")
        room_id = action_obj.roomId

        if action == "hitl_response":
            action_id = inputs.get("action_id", "")
            form_values = self._extract_form_values(inputs)
            context_id = self.session_manager.get_context_id(room_id)

            response_text = (
                json.dumps({"action": action_id, **form_values}) if form_values else action_id
            )
            self._submit_response(room_id, response_text, context_id, webex_api)

    def _extract_form_values(self, inputs: dict) -> dict:
        """Extract user-submitted form values, excluding control fields."""
        exclude = {"action", "action_id", "form_id"}
        return {k: v for k, v in inputs.items() if k not in exclude}

    def _submit_response(
        self, room_id: str, response_text: str, context_id: str, webex_api
    ) -> None:
        """Submit the HITL response back to the A2A agent."""
        from utils.ai import stream_a2a_response_webex

        logger.info(f"Submitting HITL response: {response_text[:100]}...")
        stream_a2a_response_webex(
            a2a_client=self.a2a_client,
            webex_api=webex_api,
            room_id=room_id,
            message_text=response_text,
            user_email="",
            context_id=context_id,
            session_manager=self.session_manager,
            thread_key=room_id,
        )
