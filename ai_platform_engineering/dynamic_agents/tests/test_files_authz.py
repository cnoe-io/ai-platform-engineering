import pytest
from fastapi import HTTPException

from dynamic_agents.models import UserContext
from dynamic_agents.routes.files import _require_namespace_owner


class _Conversations:
    def __init__(self, conversation: dict | None) -> None:
        self.conversation = conversation

    def find_one(self, query: dict, projection: dict) -> dict | None:
        return self.conversation


class _Database:
    def __init__(self, conversation: dict | None) -> None:
        self.conversations = _Conversations(conversation)

    def __getitem__(self, key: str) -> _Conversations:
        assert key == "conversations"
        return self.conversations


def test_subject_owner_is_authoritative_over_matching_legacy_email() -> None:
    user = UserContext(email="same@example.test", sub="subject-b")
    db = _Database({"owner_subject": "subject-a", "owner_id": "same@example.test"})

    with pytest.raises(HTTPException) as exc_info:
        _require_namespace_owner(("agent", "conversation", "filesystem"), user, db)  # type: ignore[arg-type]
    assert exc_info.value.status_code == 403


def test_legacy_conversation_uses_email_only_when_subject_was_not_persisted() -> None:
    user = UserContext(email="owner@example.test", sub="subject-b")
    db = _Database({"owner_id": "OWNER@example.test"})

    _require_namespace_owner(("agent", "conversation", "filesystem"), user, db)  # type: ignore[arg-type]
