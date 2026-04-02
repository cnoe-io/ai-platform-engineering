"""Unit tests for Space Authorization Manager."""

from unittest.mock import MagicMock, patch

from utils.space_auth import SpaceAuthorizationManager, handle_authorize_command


class TestSpaceAuthorizationManager:
    """Tests for SpaceAuthorizationManager."""

    @patch("utils.space_auth.MongoClient")
    def test_is_authorized_cache_hit(self, mock_mongo_client):
        manager = SpaceAuthorizationManager("mongodb://localhost", cache_ttl=300)
        manager._collection = MagicMock()
        manager._collection.find_one.return_value = {"_id": "doc1"}

        result1 = manager.is_authorized("room1")
        result2 = manager.is_authorized("room1")

        assert result1 is True
        assert result2 is True
        manager._collection.find_one.assert_called_once()

    @patch("utils.space_auth.MongoClient")
    def test_is_authorized_cache_miss_queries_mongodb(self, mock_mongo_client):
        manager = SpaceAuthorizationManager("mongodb://localhost", cache_ttl=300)
        manager._collection = MagicMock()
        manager._collection.find_one.return_value = {"_id": "doc1"}

        result = manager.is_authorized("room1")

        assert result is True
        manager._collection.find_one.assert_called_once_with(
            {"roomId": "room1", "status": "active"},
            {"_id": 1},
        )

    @patch("utils.space_auth.MongoClient")
    def test_is_authorized_returns_false_when_not_in_db(self, mock_mongo_client):
        manager = SpaceAuthorizationManager("mongodb://localhost", cache_ttl=300)
        manager._collection = MagicMock()
        manager._collection.find_one.return_value = None

        result = manager.is_authorized("room1")

        assert result is False

    @patch("utils.space_auth.MongoClient")
    def test_cache_ttl_expiry_requeries(self, mock_mongo_client):
        manager = SpaceAuthorizationManager("mongodb://localhost", cache_ttl=0)
        manager._collection = MagicMock()
        manager._collection.find_one.return_value = {"_id": "doc1"}

        manager.is_authorized("room1")
        manager.is_authorized("room1")

        assert manager._collection.find_one.call_count == 2

    @patch("utils.space_auth.MongoClient")
    def test_mongodb_unavailable_fallback_denies(self, mock_mongo_client):
        manager = SpaceAuthorizationManager("mongodb://localhost", cache_ttl=300)
        manager._collection = None

        result = manager.is_authorized("room1")

        assert result is False

    @patch("utils.space_auth.MongoClient")
    def test_mongodb_unavailable_uses_cache_if_available(self, mock_mongo_client):
        from pymongo.errors import PyMongoError

        manager = SpaceAuthorizationManager("mongodb://localhost", cache_ttl=300)
        manager._collection = MagicMock()
        manager._collection.find_one.return_value = {"_id": "doc1"}
        manager.is_authorized("room1")

        manager._collection.find_one.side_effect = PyMongoError("Connection failed")

        result = manager.is_authorized("room1")

        assert result is True

    @patch("utils.space_auth.MongoClient")
    def test_invalidate_cache(self, mock_mongo_client):
        manager = SpaceAuthorizationManager("mongodb://localhost", cache_ttl=300)
        manager._collection = MagicMock()
        manager._collection.find_one.return_value = {"_id": "doc1"}

        manager.is_authorized("room1")
        manager.invalidate_cache("room1")
        manager._collection.find_one.return_value = None
        result = manager.is_authorized("room1")

        assert result is False
        assert manager._collection.find_one.call_count == 2


class TestHandleAuthorizeCommand:
    """Tests for handle_authorize_command()."""

    def test_handle_authorize_command_sends_card(self):
        webex_api = MagicMock()
        room_id = "room123"
        user_email = "user@test.com"
        caipe_ui_base_url = "https://caipe.example.com"

        handle_authorize_command(webex_api, room_id, user_email, caipe_ui_base_url)

        webex_api.messages.create.assert_called_once()
        call_kwargs = webex_api.messages.create.call_args
        assert call_kwargs.kwargs["roomId"] == room_id
        attachments = call_kwargs.kwargs["attachments"]
        assert len(attachments) == 1
        card = attachments[0]["content"]
        assert "Space Authorization Required" in str(card["body"][0]["text"])
        assert "Connect to CAIPE" in str(
            next(a["title"] for a in card["actions"] if a["type"] == "Action.OpenUrl")
        )
