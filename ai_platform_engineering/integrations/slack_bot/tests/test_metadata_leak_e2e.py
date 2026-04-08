# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
End-to-end unit tests for the Slack metadata leak fix in ai.py.

Background
----------
After the ToolStrategy change, the LLM packages the entire final answer as
JSON tool-call arguments (_partial_json). No clean text tokens are emitted
during streaming; only raw ResponseFormat metadata arrives via STREAMING_RESULT
events. The Slack bot was forwarding every STREAMING_RESULT directly to the
channel, so users saw raw internal output like:

    "Returning structured response: is_task_complete=True ... content='...'"

Fix summary
-----------
* No-plan flows: buffer STREAMING_RESULT chunks silently; deliver only the
  clean FINAL_RESULT (from the ResponseFormat tool) via stopStream.
* Fallback: if FINAL_RESULT never arrives, use the buffered content so agents
  that don't emit final_result artifacts continue to work.
* Plan flows (streaming_final_answer latch): unaffected — last-step streaming
  still works as before.
* already_streamed is now True ONLY for plan flows (streaming_final_answer),
  not for no-plan flows, ensuring FINAL_RESULT is always sent via stopStream
  in the no-plan case.

These tests cover
-----------------
1. Raw ResponseFormat metadata is NEVER forwarded to Slack
2. No-plan + FINAL_RESULT  → FINAL_RESULT in stopStream, nothing in appendStream
3. No-plan + no FINAL_RESULT → buffered streaming used as fallback
4. No-plan + empty STREAMING_RESULT → nothing sent, no crash
5. Plan flow regression → last-step streaming_final_answer still streams
6. already_streamed logic change — plan already-streamed prevents duplicate post
7. Multiple STREAMING_RESULT events with metadata interleaved with real content
8. Bot user (U-prefix) + no-plan flow delivers FINAL_RESULT via postMessage
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
# 1. Raw ResponseFormat metadata NEVER reaches Slack
# ---------------------------------------------------------------------------

class TestRawMetadataBlockedFromSlack:

    RAW_METADATA_STRINGS = [
        "Returning structured response: is_task_complete=True require_user_input=False",
        "is_task_complete=True was_task_successful=True content='I searched the knowledge",
        "[FINAL ANSWER]",
        "ResponseFormat(content=",
        "PlatformEngineerResponse(",
    ]

    def test_response_format_metadata_not_in_append_stream(self):
        """
        Raw ResponseFormat metadata in STREAMING_RESULT must never appear
        in appendStream calls — these are internal strings, not user-facing content.
        """
        for raw_text in self.RAW_METADATA_STRINGS:
            events = [
                _task_event(),
                _streaming_result(raw_text),
                _final_result("Clean answer for the user."),
            ]
            mock_slack = _run_stream(events)
            appended = _get_append_stream_markdown(mock_slack)
            combined = "".join(appended)
            assert raw_text not in combined, (
                f"Raw metadata '{raw_text[:60]}' must not be forwarded to Slack via appendStream"
            )

    def test_response_format_metadata_not_in_stop_stream(self):
        """
        Raw metadata must not appear in stopStream either — only FINAL_RESULT text should.
        """
        raw = "Returning structured response: is_task_complete=True content='Private internal data'"
        events = [
            _task_event(),
            _streaming_result(raw),
            _final_result("The answer is 42."),
        ]
        mock_slack = _run_stream(events)
        stop_texts = _get_stop_stream_markdown(mock_slack)
        combined = "".join(stop_texts)
        assert raw not in combined
        assert "The answer is 42." in combined

    def test_multiple_metadata_streaming_results_all_blocked(self):
        """
        Multiple STREAMING_RESULT events containing metadata fragments
        (as emitted during tool-call JSON accumulation) are all blocked.
        """
        events = [
            _task_event(),
            _streaming_result('{"is_task_complete": true, "content": "'),
            _streaming_result("partial json fragment"),
            _streaming_result('"}'),
            _final_result("User-visible clean answer."),
        ]
        mock_slack = _run_stream(events)
        appended = _get_append_stream_markdown(mock_slack)
        assert len(appended) == 0, (
            "No-plan STREAMING_RESULT (even partial JSON) must never appear in appendStream"
        )
        stop_texts = _get_stop_stream_markdown(mock_slack)
        assert "User-visible clean answer." in "".join(stop_texts)


# ---------------------------------------------------------------------------
# 2. No-plan + FINAL_RESULT → delivered via stopStream only
# ---------------------------------------------------------------------------

class TestNoPlanFinalResultDelivery:

    def test_final_result_in_stop_stream_not_append_stream(self):
        """No-plan flow: FINAL_RESULT goes to stopStream, never appendStream."""
        events = [
            _task_event(),
            _streaming_result("intermediate chunk"),
            _final_result("Here is your Jira summary."),
        ]
        mock_slack = _run_stream(events)

        appended = _get_append_stream_markdown(mock_slack)
        assert len(appended) == 0, "STREAMING_RESULT must not reach appendStream in no-plan flow"

        stop_texts = _get_stop_stream_markdown(mock_slack)
        assert "Here is your Jira summary." in "".join(stop_texts)

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

    def test_no_plan_streaming_result_only_no_final_result_uses_fallback(self):
        """
        No-plan flow with STREAMING_RESULT but no FINAL_RESULT:
        buffered content is used as fallback so the user still gets a response.
        """
        events = [
            _task_event(),
            _streaming_result("Fallback answer part 1. "),
            _streaming_result("Fallback answer part 2."),
        ]
        mock_slack = _run_stream(events)

        # Nothing in appendStream
        appended = _get_append_stream_markdown(mock_slack)
        assert len(appended) == 0

        # Buffered content must appear in stopStream as fallback
        stop_texts = _get_stop_stream_markdown(mock_slack)
        combined = "".join(stop_texts)
        assert "Fallback answer part 1." in combined
        assert "Fallback answer part 2." in combined

    def test_empty_streaming_result_no_crash_no_output(self):
        """Empty STREAMING_RESULT events must not crash and produce no output."""
        events = [
            _task_event(),
            _streaming_result(""),
            _streaming_result("   "),
        ]
        mock_slack = _run_stream(events)
        # No crash; nothing meaningful posted
        appended = _get_append_stream_markdown(mock_slack)
        assert len(appended) == 0


# ---------------------------------------------------------------------------
# 3. No-plan flow — backward compatibility with agents not using ResponseFormat
# ---------------------------------------------------------------------------

class TestNoPlanBackwardCompatibility:

    def test_agent_without_response_format_still_delivers_content(self):
        """
        Agents that emit STREAMING_RESULT but never FINAL_RESULT (legacy agents)
        must still deliver their content via the buffered fallback path.
        """
        events = [
            _task_event(),
            _streaming_result("Here is the weather forecast: sunny, 72°F."),
        ]
        mock_slack = _run_stream(events)

        stop_texts = _get_stop_stream_markdown(mock_slack)
        combined = "".join(stop_texts)
        assert "weather forecast" in combined or "sunny" in combined

    def test_final_result_takes_priority_over_buffered_streaming(self):
        """
        When both FINAL_RESULT and buffered streaming content are present,
        FINAL_RESULT must be used (it is always the cleaner user-facing answer).
        """
        events = [
            _task_event(),
            _streaming_result("Raw intermediate text not meant for user"),
            _final_result("The clean final answer."),
        ]
        mock_slack = _run_stream(events)

        stop_texts = _get_stop_stream_markdown(mock_slack)
        combined = "".join(stop_texts)
        assert "The clean final answer." in combined
        assert "Raw intermediate text" not in combined


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

    def test_no_plan_flow_does_not_set_already_streamed_via_streamed_any_text(self):
        """
        Regression: before the fix, no-plan flows set already_streamed=True via
        streamed_any_text, causing FINAL_RESULT to be skipped entirely.
        After the fix, already_streamed is only True for streaming_final_answer.
        """
        events = [
            _task_event(),
            # STREAMING_RESULT would have set streamed_any_text before the fix,
            # causing FINAL_RESULT to be silently dropped
            _streaming_result("Intermediate synthesis fragment"),
            _final_result("The actual answer the user should see."),
        ]
        mock_slack = _run_stream(events)

        stop_texts = _get_stop_stream_markdown(mock_slack)
        combined = "".join(stop_texts)
        assert "The actual answer the user should see." in combined, (
            "FINAL_RESULT must reach the user even when STREAMING_RESULT events "
            "were emitted earlier in a no-plan flow"
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
        (as emitted by ToolStrategy JSON accumulation) followed by FINAL_RESULT.
        User sees only the clean FINAL_RESULT.
        """
        events = [
            _task_event(context_id="ctx-rag-1"),
            # These mimic the _partial_json fragments that stream during tool-call accumulation
            _streaming_result('{"is_task_complete": true, "require_user_input": false, "content": "'),
            _streaming_result("CAIPE is a Cloud AI Platform Engineering system that coordinates"),
            _streaming_result(" specialized sub-agents for platform engineering tasks."),
            _streaming_result('"}'),
            # Clean FINAL_RESULT from ResponseFormat tool
            _final_result(
                "CAIPE is a Cloud AI Platform Engineering system that coordinates "
                "specialized sub-agents for platform engineering tasks."
            ),
        ]
        mock_slack = _run_stream(events)

        # Nothing raw in appendStream
        appended = _get_append_stream_markdown(mock_slack)
        assert len(appended) == 0

        # Clean answer in stopStream
        stop_texts = _get_stop_stream_markdown(mock_slack)
        combined = "".join(stop_texts)
        assert "CAIPE is a Cloud AI Platform Engineering system" in combined
        assert '{"is_task_complete"' not in combined
        assert '"content":' not in combined

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
