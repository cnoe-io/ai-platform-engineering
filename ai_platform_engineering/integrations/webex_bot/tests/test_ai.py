"""Unit tests for A2A streaming response handler."""

from unittest.mock import MagicMock

from utils.ai import stream_a2a_response_webex


def _make_working_msg():
    msg = MagicMock()
    msg.id = "working_msg_123"
    return msg


def _make_task_event(context_id="ctx-1", trace_id="trace-1"):
    return {
        "kind": "task",
        "id": "task-1",
        "contextId": context_id,
        "metadata": {"trace_id": trace_id},
    }


def _make_artifact_event(artifact_name: str, text: str = "", append: bool = True, **artifact_kwargs):
    artifact = {"name": artifact_name, "parts": [{"kind": "text", "text": text}]}
    artifact.update(artifact_kwargs)
    return {
        "kind": "artifact-update",
        "artifact": artifact,
        "append": append,
    }


def _make_execution_plan_event(steps=None):
    steps = steps or [{"name": "Step 1", "status": "pending"}]
    return _make_artifact_event(
        "execution_plan_update",
        "",
        parts=[{"kind": "data", "data": {"steps": steps}}],
    )


def _make_final_result_event(text: str):
    return _make_artifact_event("final_result", text, append=False)


class TestStreamA2AResponseWebex:
    """Tests for stream_a2a_response_webex()."""

    def test_working_message_posted_first(self):
        a2a_client = MagicMock()
        a2a_client.send_message_stream.return_value = iter([])

        webex_api = MagicMock()
        webex_api.messages.create.return_value = _make_working_msg()

        stream_a2a_response_webex(
            a2a_client, webex_api, "room1", "Hello", "user@test.com"
        )

        create_calls = webex_api.messages.create.call_args_list
        assert len(create_calls) >= 1
        first_call = create_calls[0]
        assert first_call.kwargs.get("markdown") == "⏳ Working on it..."
        assert first_call.kwargs.get("roomId") == "room1"

    def test_final_response_posted(self):
        a2a_client = MagicMock()
        a2a_client.send_message_stream.return_value = iter([
            _make_task_event(),
            _make_final_result_event("Here is the answer."),
        ])

        webex_api = MagicMock()
        webex_api.messages.create.return_value = _make_working_msg()

        stream_a2a_response_webex(
            a2a_client, webex_api, "room1", "Hello", "user@test.com"
        )

        # First call: working message, then final response(s), then feedback card
        create_calls = webex_api.messages.create.call_args_list
        markdown_calls = [c for c in create_calls if "markdown" in c.kwargs]
        assert any("Here is the answer." in str(c.kwargs.get("markdown", "")) for c in markdown_calls)

    def test_feedback_card_posted_on_success(self):
        a2a_client = MagicMock()
        a2a_client.send_message_stream.return_value = iter([
            _make_final_result_event("Done."),
        ])

        webex_api = MagicMock()
        webex_api.messages.create.return_value = _make_working_msg()

        stream_a2a_response_webex(
            a2a_client, webex_api, "room1", "Hello", "user@test.com"
        )

        create_calls = webex_api.messages.create.call_args_list
        card_calls = [c for c in create_calls if "attachments" in c.kwargs]
        assert len(card_calls) >= 1
        feedback_attachment = next(
            (a for c in card_calls for a in c.kwargs["attachments"]
             if a.get("content", {}).get("body") and
             any("Was this response helpful?" in str(b.get("text", ""))
                 for b in a["content"].get("body", []))),
            None,
        )
        assert feedback_attachment is not None

    def test_error_handling_exception_during_streaming(self):
        a2a_client = MagicMock()
        def failing_stream(*args, **kwargs):
            yield _make_task_event()
            raise RuntimeError("Stream failed")

        a2a_client.send_message_stream.side_effect = failing_stream

        webex_api = MagicMock()
        webex_api.messages.create.return_value = _make_working_msg()

        result = stream_a2a_response_webex(
            a2a_client, webex_api, "room1", "Hello", "user@test.com"
        )

        # Should still return context_id/trace_id from task event
        assert result is not None
        assert "context_id" in result
        assert "trace_id" in result

        # Error message should be posted
        create_calls = webex_api.messages.create.call_args_list
        markdown_calls = [c for c in create_calls if "markdown" in c.kwargs]
        assert any("Stream failed" in str(c.kwargs.get("markdown", "")) for c in markdown_calls)

        # No feedback card on error
        card_calls = [c for c in create_calls if "attachments" in c.kwargs]
        feedback_cards = [
            c for c in card_calls
            if any("Was this response helpful?" in str(b.get("text", ""))
                   for a in c.kwargs.get("attachments", [])
                   for b in a.get("content", {}).get("body", []))
        ]
        assert len(feedback_cards) == 0

    def test_context_id_and_trace_id_stored_in_session_manager(self):
        a2a_client = MagicMock()
        a2a_client.send_message_stream.return_value = iter([
            _make_task_event(context_id="ctx-abc", trace_id="trace-xyz"),
            _make_final_result_event("Done."),
        ])

        webex_api = MagicMock()
        webex_api.messages.create.return_value = _make_working_msg()

        session_manager = MagicMock()
        thread_key = "thread_123"

        stream_a2a_response_webex(
            a2a_client,
            webex_api,
            "room1",
            "Hello",
            "user@test.com",
            session_manager=session_manager,
            thread_key=thread_key,
        )

        session_manager.set_context_id.assert_called_with(thread_key, "ctx-abc")
        session_manager.set_trace_id.assert_called_with(thread_key, "trace-xyz")

    def test_working_message_deleted_before_final_response(self):
        a2a_client = MagicMock()
        a2a_client.send_message_stream.return_value = iter([
            _make_final_result_event("Answer."),
        ])

        webex_api = MagicMock()
        working_msg = _make_working_msg()
        webex_api.messages.create.return_value = working_msg

        stream_a2a_response_webex(
            a2a_client, webex_api, "room1", "Hello", "user@test.com"
        )

        webex_api.messages.delete.assert_called_with(working_msg.id)

    def test_parent_id_passed_to_create_calls(self):
        a2a_client = MagicMock()
        a2a_client.send_message_stream.return_value = iter([
            _make_final_result_event("Done."),
        ])

        webex_api = MagicMock()
        webex_api.messages.create.return_value = _make_working_msg()

        stream_a2a_response_webex(
            a2a_client,
            webex_api,
            "room1",
            "Hello",
            "user@test.com",
            parent_id="parent_msg_456",
        )

        for call in webex_api.messages.create.call_args_list:
            assert call.kwargs.get("parentId") == "parent_msg_456"
