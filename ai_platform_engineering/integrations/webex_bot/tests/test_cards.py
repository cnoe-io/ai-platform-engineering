"""Unit tests for Webex Adaptive Card builders."""

from unittest.mock import MagicMock

from utils.cards import (
    CARD_SCHEMA,
    CARD_VERSION,
    create_authorize_card,
    create_error_card,
    create_execution_plan_card,
    create_feedback_card,
    create_hitl_form_card,
    create_user_input_card,
    send_card,
)


class TestCreateFeedbackCard:
    """Tests for create_feedback_card()."""

    def test_returns_valid_adaptive_card(self):
        card = create_feedback_card()
        assert card["$schema"] == CARD_SCHEMA
        assert card["type"] == "AdaptiveCard"
        assert card["version"] == CARD_VERSION

    def test_has_two_submit_actions(self):
        card = create_feedback_card()
        actions = card.get("actions", [])
        assert len(actions) == 2
        assert all(a["type"] == "Action.Submit" for a in actions)

    def test_helpful_action_positive(self):
        card = create_feedback_card()
        helpful = next(a for a in card["actions"] if a["data"]["value"] == "positive")
        assert helpful["title"] == "👍 Helpful"
        assert helpful["style"] == "positive"

    def test_not_helpful_action_destructive(self):
        card = create_feedback_card()
        not_helpful = next(a for a in card["actions"] if a["data"]["value"] == "negative")
        assert not_helpful["title"] == "👎 Not Helpful"
        assert not_helpful["style"] == "destructive"


class TestCreateHitlFormCard:
    """Tests for create_hitl_form_card()."""

    def test_text_field(self):
        form_data = {
            "title": "Confirm",
            "fields": [
                {"id": "field1", "type": "text", "label": "Name", "placeholder": "Enter name"}
            ],
        }
        card = create_hitl_form_card(form_data)
        body = card["body"]
        assert any("Name" in str(b.get("text", "")) for b in body)
        assert any(b.get("type") == "Input.Text" and b.get("id") == "field1" for b in body)

    def test_select_field(self):
        form_data = {
            "fields": [
                {
                    "id": "choice1",
                    "type": "select",
                    "label": "Select",
                    "options": [{"label": "A", "value": "a"}, {"label": "B", "value": "b"}],
                }
            ],
        }
        card = create_hitl_form_card(form_data)
        body = card["body"]
        choice_input = next(b for b in body if b.get("type") == "Input.ChoiceSet")
        assert choice_input["id"] == "choice1"
        assert choice_input["isMultiSelect"] is False
        assert len(choice_input["choices"]) == 2

    def test_multiselect_field(self):
        form_data = {
            "fields": [
                {
                    "id": "multi1",
                    "type": "multiselect",
                    "options": [{"value": "x"}, {"value": "y"}],
                }
            ],
        }
        card = create_hitl_form_card(form_data)
        body = card["body"]
        choice_input = next(b for b in body if b.get("type") == "Input.ChoiceSet")
        assert choice_input["isMultiSelect"] is True

    def test_default_actions_when_none_provided(self):
        form_data = {"fields": []}
        card = create_hitl_form_card(form_data)
        actions = card["actions"]
        assert len(actions) >= 2
        approve = next(a for a in actions if a["data"]["action_id"] == "approve")
        reject = next(a for a in actions if a["data"]["action_id"] == "reject")
        assert approve["style"] == "positive"
        assert reject["style"] == "destructive"

    def test_custom_actions(self):
        form_data = {
            "fields": [],
            "actions": [
                {"id": "ok", "label": "OK", "style": "primary"},
                {"id": "cancel", "label": "Cancel", "style": "danger"},
            ],
        }
        card = create_hitl_form_card(form_data)
        actions = card["actions"]
        assert len(actions) == 2
        assert actions[0]["title"] == "OK"
        assert actions[1]["title"] == "Cancel"


class TestCreateExecutionPlanCard:
    """Tests for create_execution_plan_card()."""

    def test_returns_valid_card(self):
        steps = [{"name": "Step 1", "status": "pending"}]
        card = create_execution_plan_card(steps)
        assert card["type"] == "AdaptiveCard"
        assert "Execution Plan" in str(card["body"][0]["text"])

    def test_steps_with_various_statuses(self):
        steps = [
            {"name": "A", "status": "pending"},
            {"name": "B", "status": "running"},
            {"name": "C", "status": "completed"},
            {"name": "D", "status": "failed"},
        ]
        card = create_execution_plan_card(steps)
        body_text = " ".join(b.get("text", "") for b in card["body"] if b.get("type") == "TextBlock")
        assert "⏳ A" in body_text
        assert "🔄 B" in body_text
        assert "✅ C" in body_text
        assert "❌ D" in body_text


class TestCreateUserInputCard:
    """Tests for create_user_input_card()."""

    def test_text_field(self):
        fields = [{"name": "input1", "label": "Name", "placeholder": "Enter name"}]
        card = create_user_input_card(fields)
        assert any(b.get("type") == "Input.Text" and b.get("id") == "input1" for b in card["body"])

    def test_choice_field(self):
        fields = [
            {"name": "choice1", "label": "Pick", "field_values": ["A", "B", "C"]},
        ]
        card = create_user_input_card(fields)
        choice_input = next(b for b in card["body"] if b.get("type") == "Input.ChoiceSet")
        assert choice_input["id"] == "choice1"
        assert len(choice_input["choices"]) == 3

    def test_submit_action(self):
        card = create_user_input_card([])
        actions = card["actions"]
        submit = next(a for a in actions if a["data"]["action"] == "user_input")
        assert submit["title"] == "Submit"
        assert submit["style"] == "positive"


class TestCreateErrorCard:
    """Tests for create_error_card()."""

    def test_error_message_displayed(self):
        card = create_error_card("Something went wrong")
        body = card["body"]
        assert any("❌ Error" in str(b.get("text", "")) for b in body)
        assert any(b.get("text") == "Something went wrong" for b in body)

    def test_has_attention_color(self):
        card = create_error_card("Error")
        assert any(b.get("color") == "Attention" for b in card["body"])


class TestCreateAuthorizeCard:
    """Tests for create_authorize_card()."""

    def test_proper_url_construction(self):
        room_id = "room123"
        base_url = "https://caipe.example.com"
        card = create_authorize_card(room_id, base_url)
        action = next(a for a in card["actions"] if a["type"] == "Action.OpenUrl")
        assert f"roomId={room_id}" in action["url"]
        assert "api/admin/integrations/webex/authorize" in action["url"]

    def test_strips_trailing_slash_from_base_url(self):
        card = create_authorize_card("r1", "https://example.com/")
        action = next(a for a in card["actions"] if a["type"] == "Action.OpenUrl")
        assert "https://example.com/api" in action["url"]
        assert "https://example.com//api" not in action["url"]


class TestSendCard:
    """Tests for send_card()."""

    def test_calls_webex_api_messages_create_with_correct_attachments(self):
        webex_api = MagicMock()
        room_id = "room456"
        card = create_feedback_card()

        send_card(webex_api, room_id, card)

        webex_api.messages.create.assert_called_once()
        call_kwargs = webex_api.messages.create.call_args
        assert call_kwargs.kwargs["roomId"] == room_id
        attachments = call_kwargs.kwargs["attachments"]
        assert len(attachments) == 1
        assert attachments[0]["contentType"] == "application/vnd.microsoft.card.adaptive"
        assert attachments[0]["content"] == card

    def test_includes_parent_id_when_provided(self):
        webex_api = MagicMock()
        send_card(webex_api, "room123", create_feedback_card(), parent_id="msg789")
        call_kwargs = webex_api.messages.create.call_args
        assert call_kwargs.kwargs["parentId"] == "msg789"

    def test_sets_fallback_text(self):
        webex_api = MagicMock()
        fallback = "Fallback text"
        send_card(webex_api, "room123", create_feedback_card(), fallback_text=fallback)
        assert webex_api.messages.create.call_args.kwargs["text"] == fallback
