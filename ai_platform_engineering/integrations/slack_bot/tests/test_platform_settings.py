"""Tests for the runtime platform-settings reader (default + VictorOps agents)."""

from __future__ import annotations

from ai_platform_engineering.integrations.slack_bot.utils.platform_settings import (
    PlatformSettingsReader,
    resolve_default_agent_id,
    resolve_victorops_agent_id,
)

# Dotted path for string-target monkeypatching of the module-global reader.
# Using a string keeps a single import style for this module (avoids mixing
# ``from ... import`` with a function-local ``import ... as ps``).
_MODULE = "ai_platform_engineering.integrations.slack_bot.utils.platform_settings"


class _Collection:
    def __init__(self, doc: dict[str, object] | None) -> None:
        self._doc = doc
        self.queries: list[dict[str, object]] = []

    def find_one(self, query: dict[str, object]) -> dict[str, object] | None:
        self.queries.append(query)
        return self._doc


def test_reader_returns_db_values() -> None:
    collection = _Collection(
        {
            "_id": "platform_settings",
            "default_agent_id": "db-default",
            "slack_victorops_escalation_agent_id": "db-vo",
        }
    )
    reader = PlatformSettingsReader(collection_factory=lambda: collection)

    assert reader.default_agent_id() == "db-default"
    assert reader.victorops_escalation_agent_id() == "db-vo"
    assert collection.queries[0] == {"_id": "platform_settings"}


def test_reader_treats_blank_values_as_unset() -> None:
    reader = PlatformSettingsReader(
        collection_factory=lambda: _Collection(
            {"default_agent_id": "   ", "slack_victorops_escalation_agent_id": ""}
        )
    )

    assert reader.default_agent_id() is None
    assert reader.victorops_escalation_agent_id() is None


def test_reader_caches_document_within_ttl() -> None:
    collection = _Collection({"default_agent_id": "db-default"})
    reader = PlatformSettingsReader(collection_factory=lambda: collection, ttl_seconds=600)

    reader.default_agent_id()
    reader.default_agent_id()

    # Second read served from cache — only one Mongo round trip.
    assert len(collection.queries) == 1


def test_reader_missing_document_returns_none() -> None:
    reader = PlatformSettingsReader(collection_factory=lambda: _Collection(None))

    assert reader.default_agent_id() is None
    assert reader.victorops_escalation_agent_id() is None


def test_reader_handles_unconfigured_mongo(monkeypatch) -> None:
    monkeypatch.delenv("MONGODB_URI", raising=False)
    reader = PlatformSettingsReader()

    # No collection factory and no MONGODB_URI -> graceful "no override".
    assert reader.default_agent_id() is None


def test_resolve_default_agent_id_prefers_db(monkeypatch) -> None:
    monkeypatch.setattr(f"{_MODULE}._default_reader", PlatformSettingsReader(collection_factory=lambda: _Collection({"default_agent_id": "db-default"})))
    assert resolve_default_agent_id("env-default") == "db-default"


def test_resolve_default_agent_id_falls_back_to_env(monkeypatch) -> None:
    monkeypatch.setattr(f"{_MODULE}._default_reader", PlatformSettingsReader(collection_factory=lambda: _Collection({})))
    assert resolve_default_agent_id("env-default") == "env-default"
    assert resolve_default_agent_id(None) is None
    assert resolve_default_agent_id("  ") is None


def test_resolve_victorops_agent_id_prefers_db_then_env(monkeypatch) -> None:
    monkeypatch.setattr(f"{_MODULE}._default_reader", PlatformSettingsReader(collection_factory=lambda: _Collection({"slack_victorops_escalation_agent_id": "db-vo"})))
    assert resolve_victorops_agent_id("env-vo") == "db-vo"

    monkeypatch.setattr(f"{_MODULE}._default_reader", PlatformSettingsReader(collection_factory=lambda: _Collection({})))
    assert resolve_victorops_agent_id("env-vo") == "env-vo"
    assert resolve_victorops_agent_id(None) is None
