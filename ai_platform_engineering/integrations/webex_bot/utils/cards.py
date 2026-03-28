"""
Adaptive Card builders for Webex.

Builds Adaptive Card payloads for:
- Feedback (thumbs up/down)
- HITL forms (from A2A input-required events)
- Execution plan display
- Error display
- Authorization prompt
"""

from typing import Any, Dict, List, Optional


CARD_SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json"
CARD_VERSION = "1.3"


def _base_card(body: List[Dict], actions: Optional[List[Dict]] = None) -> Dict:
    """Create a base Adaptive Card structure."""
    card = {
        "$schema": CARD_SCHEMA,
        "type": "AdaptiveCard",
        "version": CARD_VERSION,
        "body": body,
    }
    if actions:
        card["actions"] = actions
    return card


def send_card(
    webex_api,
    room_id: str,
    card: dict,
    parent_id: Optional[str] = None,
    fallback_text: str = "Card content (requires a client that supports Adaptive Cards)",
) -> object:
    """Send an Adaptive Card to a Webex room."""
    kwargs = {
        "roomId": room_id,
        "text": fallback_text,
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": card,
            }
        ],
    }
    if parent_id:
        kwargs["parentId"] = parent_id
    return webex_api.messages.create(**kwargs)


def create_feedback_card() -> Dict:
    """Create a feedback card with thumbs up/down buttons."""
    return _base_card(
        body=[
            {
                "type": "TextBlock",
                "text": "Was this response helpful?",
                "wrap": True,
                "weight": "Bolder",
            }
        ],
        actions=[
            {
                "type": "Action.Submit",
                "title": "👍 Helpful",
                "data": {"action": "feedback", "value": "positive"},
                "style": "positive",
            },
            {
                "type": "Action.Submit",
                "title": "👎 Not Helpful",
                "data": {"action": "feedback", "value": "negative"},
                "style": "destructive",
            },
        ],
    )


def create_hitl_form_card(form_data: Dict[str, Any]) -> Dict:
    """Create a HITL form card from A2A input-required event data."""
    body = []

    title = form_data.get("title", "Action Required")
    body.append(
        {
            "type": "TextBlock",
            "text": title,
            "weight": "Bolder",
            "size": "Medium",
            "wrap": True,
        }
    )

    description = form_data.get("description", "")
    if description:
        body.append(
            {
                "type": "TextBlock",
                "text": description,
                "wrap": True,
            }
        )

    for field_def in form_data.get("fields", []):
        field_id = field_def.get("id", field_def.get("name", ""))
        field_type = field_def.get("type", "text")
        label = field_def.get("label", field_def.get("name", ""))

        body.append(
            {
                "type": "TextBlock",
                "text": label,
                "wrap": True,
            }
        )

        if field_type in ("select", "multiselect"):
            choices = [
                {
                    "title": opt.get("label", opt.get("value", "")),
                    "value": opt.get("value", ""),
                }
                for opt in field_def.get("options", [])
            ]
            body.append(
                {
                    "type": "Input.ChoiceSet",
                    "id": field_id,
                    "choices": choices,
                    "isMultiSelect": field_type == "multiselect",
                    "style": "compact",
                    "placeholder": field_def.get("placeholder", ""),
                }
            )
        else:
            body.append(
                {
                    "type": "Input.Text",
                    "id": field_id,
                    "placeholder": field_def.get("placeholder", ""),
                    "isMultiline": field_type == "textarea",
                }
            )

    actions_data = form_data.get("actions", [])
    actions = []
    for action_def in actions_data:
        action = {
            "type": "Action.Submit",
            "title": action_def.get("label", action_def.get("name", "Submit")),
            "data": {
                "action": "hitl_response",
                "action_id": action_def.get("id", action_def.get("name", "")),
                "form_id": form_data.get("form_id", ""),
            },
        }
        style = action_def.get("style", "")
        if style in ("primary", "positive"):
            action["style"] = "positive"
        elif style in ("danger", "destructive"):
            action["style"] = "destructive"
        actions.append(action)

    if not actions:
        actions = [
            {
                "type": "Action.Submit",
                "title": "Approve",
                "data": {"action": "hitl_response", "action_id": "approve"},
                "style": "positive",
            },
            {
                "type": "Action.Submit",
                "title": "Reject",
                "data": {"action": "hitl_response", "action_id": "reject"},
                "style": "destructive",
            },
        ]

    return _base_card(body=body, actions=actions)


def create_execution_plan_card(steps: List[Dict]) -> Dict:
    """Create an Adaptive Card displaying an execution plan."""
    body = [
        {
            "type": "TextBlock",
            "text": "Execution Plan",
            "weight": "Bolder",
            "size": "Medium",
        }
    ]

    for i, step in enumerate(steps, 1):
        status = step.get("status", "pending")
        name = step.get("name", step.get("title", f"Step {i}"))
        emoji = {
            "pending": "⏳",
            "running": "🔄",
            "in_progress": "🔄",
            "completed": "✅",
            "failed": "❌",
        }.get(status, "⏳")
        body.append(
            {
                "type": "TextBlock",
                "text": f"{i}. {emoji} {name}",
                "wrap": True,
            }
        )

    return _base_card(body=body)


def create_user_input_card(input_fields: List[Dict]) -> Dict:
    """Create a user input card from dynamic input field definitions."""
    body = [
        {
            "type": "TextBlock",
            "text": "Please provide the following information:",
            "weight": "Bolder",
            "wrap": True,
        }
    ]

    for field_def in input_fields:
        name = field_def.get("name", field_def.get("id", ""))
        label = field_def.get("label", name)
        field_values = field_def.get("field_values", [])

        body.append({"type": "TextBlock", "text": label, "wrap": True})

        if field_values:
            choices = [{"title": v, "value": v} for v in field_values]
            body.append(
                {
                    "type": "Input.ChoiceSet",
                    "id": name,
                    "choices": choices,
                    "style": "compact",
                }
            )
        else:
            body.append(
                {
                    "type": "Input.Text",
                    "id": name,
                    "placeholder": field_def.get("placeholder", f"Enter {label}"),
                    "isMultiline": field_def.get("multiline", False),
                }
            )

    return _base_card(
        body=body,
        actions=[
            {
                "type": "Action.Submit",
                "title": "Submit",
                "data": {"action": "user_input"},
                "style": "positive",
            }
        ],
    )


def create_error_card(error_message: str) -> Dict:
    """Create an error display card."""
    return _base_card(
        body=[
            {
                "type": "TextBlock",
                "text": "❌ Error",
                "weight": "Bolder",
                "size": "Medium",
                "color": "Attention",
            },
            {"type": "TextBlock", "text": error_message, "wrap": True},
        ]
    )


def create_authorize_card(room_id: str, caipe_ui_base_url: str) -> Dict:
    """Create an authorization prompt card with a 'Connect to CAIPE' button."""
    auth_url = f"{caipe_ui_base_url.rstrip('/')}/api/admin/integrations/webex/authorize?roomId={room_id}"
    return _base_card(
        body=[
            {
                "type": "TextBlock",
                "text": "🔐 Space Authorization Required",
                "weight": "Bolder",
                "size": "Medium",
            },
            {
                "type": "TextBlock",
                "text": "This space needs to be authorized to use CAIPE. Click the button below to connect this space.",
                "wrap": True,
            },
        ],
        actions=[
            {
                "type": "Action.OpenUrl",
                "title": "Connect to CAIPE",
                "url": auth_url,
                "style": "positive",
            }
        ],
    )
