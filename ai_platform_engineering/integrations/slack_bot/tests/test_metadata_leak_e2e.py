# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
End-to-end unit tests for Slack streaming behaviour in ai.py.

Background
----------
No-plan STREAMING_RESULT events are streamed live to Slack via appendStream,
giving users real-time output.  FINAL_RESULT is not re-sent in stopStream
when content was already streamed (already_streamed=True).

Plan flows use the streaming_final_answer latch for last-step streaming.

These tests cover
-----------------
1. No-plan STREAMING_RESULT → streamed live via appendStream
2. FINAL_RESULT not duplicated in stopStream when already streamed
3. No-plan + no FINAL_RESULT → content delivered via appendStream
4. No-plan + empty STREAMING_RESULT → nothing sent, no crash
5. Plan flow regression → last-step streaming_final_answer still streams
6. already_streamed logic change — plan already-streamed prevents duplicate post
7. Bot user (B-prefix) + no-plan flow delivers FINAL_RESULT via postMessage
"""

from unittest.mock import Mock

from ai_platform_engineering.integrations.slack_bot.utils.ai import stream_a2a_response


# ---------------------------------------------------------------------------
# Event builders (mirrors test_ai_plan_streaming.py helpers)
# ---------------------------------------------------------------------------

def _task_event(context_id="ctx-1"):
    return {"kind": "task", "id": "t1", "contextId": context_id}


def _streaming_result(text, append=True):
    return {
        "kind": "artifact-update",
        "append": append,
        "artifact": {
            "name": "streaming_result",
            "parts": [{"kind": "text", "text": text}],
        },
    }


def _final_result(text):
    return {
        "kind": "artifact-update",
        "artifact": {
            "name": "final_result",
            "parts": [{"kind": "text", "text": text}],
        },
    }


def _plan_event(steps):
    return {
        "kind": "artifact-update",
        "artifact": {
            "name": "execution_plan_update",
            "parts": [{"kind": "data", "data": {"steps": steps}}],
        },
    }


def _make_step(step_id, title, status="pending", order=0, agent=""):
    return {"step_id": step_id, "title": title, "status": status, "order": order, "agent": agent}


def _mock_slack():
    mock = Mock()
    mock.chat_startStream.return_value = {"ts": "stream-ts-1"}
    mock.chat_appendStream.return_value = {"ok": True}
    mock.chat_stopStream.return_value = {"ok": True}
    mock.chat_postMessage.return_value = {"ts": "msg-ts-1"}
    mock.chat_delete.return_value = {"ok": True}
    mock.assistant_threads_setStatus.return_value = {"ok": True}
    return mock


def _get_append_stream_markdown(mock_slack):
    """Collect all markdown_text chunks sent via appendStream."""
    texts = []
    for c in mock_slack.chat_appendStream.call_args_list:
        for chunk in c.kwargs.get("chunks", []):
            if chunk.get("type") == "markdown_text":
                texts.append(chunk["text"])
    return texts


def _get_stop_stream_markdown(mock_slack):
    """Collect all markdown_text chunks sent via stopStream."""
    stop_call = mock_slack.chat_stopStream.call_args
    if not stop_call:
        return []
    chunks = stop_call.kwargs.get("chunks") or []
    return [c.get("text", "") for c in chunks if c.get("type") == "markdown_text"]


def _run_stream(events, user_id="U123", **kwargs):
    """Run stream_a2a_response with a mock A2A client returning given events."""
    mock_a2a = Mock()
    mock_a2a.send_message_stream.return_value = iter(events)
    mock_slack = _mock_slack()
    stream_a2a_response(
        a2a_client=mock_a2a,
        slack_client=mock_slack,
        channel_id="C1",
        thread_ts="t1",
        message_text="test query",
        team_id="T1",
        user_id=user_id,
        **kwargs,
    )
    return mock_slack


# ---------------------------------------------------------------------------
# 1. No-plan STREAMING_RESULT is streamed live
# ---------------------------------------------------------------------------

class TestNoPlanStreamingResultDelivered:

    def test_streaming_result_appears_in_append_stream(self):
        """No-plan STREAMING_RESULT content is streamed live via appendStream."""
        events = [
            _task_event(),
            _streaming_result("Here is the answer."),
            _final_result("Here is the answer."),
        ]
        mock_slack = _run_stream(events)
        appended = _get_append_stream_markdown(mock_slack)
        combined = "".join(appended)
        assert "Here is the answer" in combined, (
            "No-plan STREAMING_RESULT should be streamed live via appendStream"
        )

    def test_final_result_not_duplicated_in_stop_stream_when_already_streamed(self):
        """When STREAMING_RESULT was streamed live, FINAL_RESULT is not re-sent in stopStream."""
        events = [
            _task_event(),
            _streaming_result("The answer is 42."),
            _final_result("The answer is 42."),
        ]
        mock_slack = _run_stream(events)
        stop_texts = _get_stop_stream_markdown(mock_slack)
        combined = "".join(stop_texts)
        assert "The answer is 42." not in combined, (
            "FINAL_RESULT must not be re-sent in stopStream when already streamed"
        )

    def test_multiple_streaming_results_all_delivered(self):
        """Multiple STREAMING_RESULT events are all delivered via appendStream."""
        events = [
            _task_event(),
            _streaming_result('{"is_task_complete": true, "content": "'),
            _streaming_result("partial json fragment"),
            _streaming_result('"}'),
            _final_result("User-visible clean answer."),
        ]
        mock_slack = _run_stream(events)
        appended = _get_append_stream_markdown(mock_slack)
        assert len(appended) > 0, (
            "No-plan STREAMING_RESULT events should be streamed live"
        )


# ---------------------------------------------------------------------------
# 2. No-plan STREAMING_RESULT delivery and FINAL_RESULT handling
# ---------------------------------------------------------------------------

class TestNoPlanFinalResultDelivery:

    def test_streaming_result_streamed_live_via_append_stream(self):
        """No-plan flow: STREAMING_RESULT is streamed live via appendStream."""
        events = [
            _task_event(),
            _streaming_result("intermediate chunk"),
            _final_result("Here is your Jira summary."),
        ]
        mock_slack = _run_stream(events)

        appended = _get_append_stream_markdown(mock_slack)
        assert len(appended) > 0, "No-plan STREAMING_RESULT should be streamed live"
        assert "intermediate chunk" in "".join(appended)

    def test_start_stream_called_when_final_result_delivered(self):
        """startStream is initiated before delivering FINAL_RESULT via stopStream."""
        events = [
            _task_event(),
            _final_result("Answer text."),
        ]
        mock_slack = _run_stream(events)
        mock_slack.chat_startStream.assert_called()

    def test_stop_stream_called_once(self):
        """stopStream is called exactly once at the end of the no-plan flow."""
        events = [
            _task_event(),
            _streaming_result("chunk1"),
            _streaming_result("chunk2"),
            _final_result("Final answer."),
        ]
        mock_slack = _run_stream(events)
        assert mock_slack.chat_stopStream.call_count == 1

    def test_no_plan_streaming_result_only_no_final_result_streams_live(self):
        """No-plan flow with STREAMING_RESULT but no FINAL_RESULT: content is streamed live."""
        events = [
            _task_event(),
            _streaming_result("Fallback answer part 1. "),
            _streaming_result("Fallback answer part 2."),
        ]
        mock_slack = _run_stream(events)

        appended = _get_append_stream_markdown(mock_slack)
        assert len(appended) > 0, "No-plan STREAMING_RESULT should be streamed live"
        combined = "".join(appended)
        assert "Fallback answer part 1." in combined

    def test_empty_streaming_result_no_crash(self):
        """Empty STREAMING_RESULT events must not crash."""
        events = [
            _task_event(),
            _streaming_result(""),
            _streaming_result("   "),
        ]
        mock_slack = _run_stream(events)
        # No crash; whitespace-only may be streamed but nothing meaningful
        appended = _get_append_stream_markdown(mock_slack)
        for text in appended:
            assert text.strip() == "", f"Only whitespace expected, got: {text!r}"


# ---------------------------------------------------------------------------
# 3. No-plan flow — backward compatibility with agents not using ResponseFormat
# ---------------------------------------------------------------------------

class TestNoPlanBackwardCompatibility:

    def test_agent_without_response_format_still_delivers_content(self):
        """
        Agents that emit STREAMING_RESULT but never FINAL_RESULT (legacy agents)
        deliver content live via appendStream.
        """
        events = [
            _task_event(),
            _streaming_result("Here is the weather forecast: sunny, 72°F."),
        ]
        mock_slack = _run_stream(events)

        appended = _get_append_stream_markdown(mock_slack)
        combined = "".join(appended)
        assert "weather forecast" in combined or "sunny" in combined

    def test_streaming_result_already_delivered_final_not_duplicated(self):
        """
        When STREAMING_RESULT was streamed live, FINAL_RESULT is not re-posted
        in stopStream (already_streamed prevents duplication).
        """
        events = [
            _task_event(),
            _streaming_result("Intermediate text streamed live"),
            _final_result("The clean final answer."),
        ]
        mock_slack = _run_stream(events)

        # STREAMING_RESULT was delivered live
        appended = _get_append_stream_markdown(mock_slack)
        assert len(appended) > 0

        # FINAL_RESULT not re-sent in stopStream since content was already streamed
        stop_texts = _get_stop_stream_markdown(mock_slack)
        combined = "".join(stop_texts)
        assert "The clean final answer." not in combined


# ---------------------------------------------------------------------------
# 4. Plan flow regression — streaming_final_answer still works
# ---------------------------------------------------------------------------

class TestPlanFlowStreamingRegression:

    def test_plan_flow_last_step_streams_via_append_stream(self):
        """
        Plan flow with streaming_final_answer latch must still stream the
        final answer via appendStream (this path is unchanged by the fix).
        """
        step = _make_step("s1", "Fetch Jira tickets", status="pending")
        in_progress = _make_step("s1", "Fetch Jira tickets", status="in_progress")
        completed = _make_step("s1", "Fetch Jira tickets", status="completed")

        events = [
            _task_event(),
            _plan_event([step]),
            _plan_event([in_progress]),
            _streaming_result("Here are the Jira tickets: "),
            _streaming_result("JIRA-123: Fix login bug"),
            _plan_event([completed]),
        ]
        mock_slack = _run_stream(events)

        appended = _get_append_stream_markdown(mock_slack)
        combined = "".join(appended)
        assert "Jira" in combined or "JIRA" in combined, (
            "Plan flow last-step streaming must still reach appendStream"
        )

    def test_plan_flow_already_streamed_prevents_duplicate_post(self):
        """
        When streaming_final_answer fired, already_streamed=True.
        The final answer must NOT also be sent via stopStream (would duplicate it).
        """
        step = _make_step("s1", "Search", status="pending")
        in_progress = _make_step("s1", "Search", status="in_progress")
        completed = _make_step("s1", "Search", status="completed")

        events = [
            _task_event(),
            _plan_event([step]),
            _plan_event([in_progress]),
            _streaming_result("Streamed answer during last step"),
            _plan_event([completed]),
            _final_result("Same answer again from FINAL_RESULT"),
        ]
        mock_slack = _run_stream(events)

        # stopStream must not carry the final answer text as a markdown chunk
        # (it was already delivered via appendStream)
        stop_chunks = mock_slack.chat_stopStream.call_args
        if stop_chunks:
            chunks = stop_chunks.kwargs.get("chunks") or []
            markdown_in_stop = [c.get("text", "") for c in chunks if c.get("type") == "markdown_text"]
            assert not any("Same answer again" in t for t in markdown_in_stop), (
                "Plan flow: FINAL_RESULT must not be re-posted in stopStream when "
                "streaming_final_answer already fired"
            )

    def test_no_plan_flow_already_streamed_prevents_duplicate_in_stop(self):
        """
        No-plan flow: STREAMING_RESULT sets already_streamed=True via
        streamed_any_text, so FINAL_RESULT is not re-sent in stopStream.
        Content was already delivered live via appendStream.
        """
        events = [
            _task_event(),
            _streaming_result("Intermediate synthesis fragment"),
            _final_result("The actual answer the user should see."),
        ]
        mock_slack = _run_stream(events)

        # Content was streamed live
        appended = _get_append_stream_markdown(mock_slack)
        assert len(appended) > 0, "STREAMING_RESULT should be streamed live"

        # FINAL_RESULT not duplicated in stopStream
        stop_texts = _get_stop_stream_markdown(mock_slack)
        combined = "".join(stop_texts)
        assert "The actual answer the user should see." not in combined, (
            "FINAL_RESULT must not be re-sent in stopStream when already streamed"
        )


# ---------------------------------------------------------------------------
# 5. Bot user (non-streaming) path
# ---------------------------------------------------------------------------

class TestBotUserNoPlanFlow:
    """
    Bot users (B-prefix) receive responses via chat_postMessage instead of
    the streaming API. The metadata-leak fix must not break this path.
    """

    def test_bot_user_receives_final_result_via_post_message(self):
        """Bot user no-plan flow delivers FINAL_RESULT via postMessage."""
        events = [
            _task_event(),
            _streaming_result("Internal metadata fragment"),
            _final_result("Bot answer: here is what I found."),
        ]
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(events)
        mock_slack = _mock_slack()

        stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="query",
            team_id="T1",
            user_id="B123",  # Bot user → postMessage path
        )

        # At least one postMessage was made
        assert mock_slack.chat_postMessage.call_count >= 1

    def test_bot_user_metadata_not_in_post_message(self):
        """Bot user: raw ResponseFormat metadata must not appear in chat_postMessage."""
        raw_meta = "Returning structured response: is_task_complete=True content='private'"
        events = [
            _task_event(),
            _streaming_result(raw_meta),
            _final_result("Clean bot answer."),
        ]
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(events)
        mock_slack = _mock_slack()

        stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="query",
            team_id="T1",
            user_id="B123",
        )

        for post_call in mock_slack.chat_postMessage.call_args_list:
            text = str(post_call)
            assert raw_meta not in text, (
                "Raw ResponseFormat metadata must never appear in chat_postMessage"
            )


# ---------------------------------------------------------------------------
# 6. Integration: full realistic scenario
# ---------------------------------------------------------------------------

class TestFullRealisticScenario:

    def test_realistic_rag_query_no_plan(self):
        """
        Realistic no-plan flow: RAG query with several streaming fragments
        followed by FINAL_RESULT. Content is streamed live via appendStream.
        """
        events = [
            _task_event(context_id="ctx-rag-1"),
            _streaming_result("CAIPE is a Cloud AI Platform Engineering system that coordinates"),
            _streaming_result(" specialized sub-agents for platform engineering tasks."),
            _final_result(
                "CAIPE is a Cloud AI Platform Engineering system that coordinates "
                "specialized sub-agents for platform engineering tasks."
            ),
        ]
        mock_slack = _run_stream(events)

        appended = _get_append_stream_markdown(mock_slack)
        assert len(appended) > 0, "No-plan STREAMING_RESULT should be streamed live"
        combined = "".join(appended)
        assert "CAIPE is a Cloud AI Platform Engineering system" in combined

    def test_interrupted_session_new_query_delivers_correct_response(self):
        """
        Simulate: previous session interrupted (no content), new query arrives.
        FINAL_RESULT from the new query must be delivered cleanly.
        """
        events = [
            _task_event(context_id="ctx-new"),
            _final_result("Your ArgoCD application is healthy and in sync."),
        ]
        mock_slack = _run_stream(events)

        stop_texts = _get_stop_stream_markdown(mock_slack)
        assert "ArgoCD application is healthy" in "".join(stop_texts)
