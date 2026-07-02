import pytest
from pydantic import ValidationError

from mcp_webex.mcp_server import PostMessage


def test_post_message_accepts_markdown_without_text():
    message = PostMessage(
        to_person_email="person@example.com",
        markdown="**Hello from Pam**",
    )

    assert message.text is None
    assert message.markdown == "**Hello from Pam**"


def test_post_message_requires_text_or_markdown():
    with pytest.raises(ValidationError, match="Either 'text' or 'markdown'"):
        PostMessage(to_person_email="person@example.com")
