import pytest
from pydantic import ValidationError

from mcp_server import PostMessage


@pytest.mark.parametrize(
    ("content", "expected_text", "expected_markdown"),
    [
        ({"text": "Plain text"}, "Plain text", None),
        ({"markdown": "**Markdown**"}, None, "**Markdown**"),
    ],
)
def test_post_message_accepts_text_or_markdown(
    content: dict[str, str],
    expected_text: str | None,
    expected_markdown: str | None,
) -> None:
    message = PostMessage(room_id="room-123", **content)

    assert message.text == expected_text
    assert message.markdown == expected_markdown


def test_post_message_requires_content() -> None:
    with pytest.raises(ValidationError, match="Either 'text' or 'markdown'"):
        PostMessage(room_id="room-123")


def test_post_message_requires_recipient() -> None:
    with pytest.raises(ValidationError, match="Either 'room_id' or 'to_person_email'"):
        PostMessage(text="Hello")


def test_post_message_schema_does_not_require_text() -> None:
    required = PostMessage.model_json_schema().get("required", [])

    assert "text" not in required
