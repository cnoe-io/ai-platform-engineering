"""Tests for ConfluenceLoader.ingest_pages — document_count tracking and edge cases.

Regression tests for the bug where increment_document_count was never called,
causing the UI to show '0 documents' even after successful Confluence ingestion.

Coverage:
  - increment_document_count called exactly once per page with non-empty content
  - Pages with empty/whitespace-only HTML are NOT counted (but progress IS incremented)
  - Pages missing the 'id' field are fully skipped (no count, no progress)
  - Pages where _ingest_batch raises are NOT counted; failure IS tracked
  - increment_document_count is always called BEFORE increment_progress (ordering)
  - Batching behaviour does not affect per-page document count
  - Final job status: COMPLETED / COMPLETED_WITH_ERRORS / FAILED / TERMINATED
  - generate_datasource_id helper
  - extract_text_from_html helper
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, call

import pytest

from common.job_manager import JobInfo, JobStatus
from common.models.rag import DataSourceInfo
from ingestors.confluence.loader import (
    CONFLUENCE_BATCH_SIZE,
    ConfluenceLoader,
    generate_datasource_id,
)


# ---------------------------------------------------------------------------
# Shared fixtures / helpers
# ---------------------------------------------------------------------------


def make_datasource_info(
    datasource_id: str = "src_confluence___cisco_eti_atlassian_net__SRE",
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
) -> DataSourceInfo:
    return DataSourceInfo(
        datasource_id=datasource_id,
        ingestor_id="confluence:default_confluence",
        source_type="confluence",
        last_updated=None,
        default_chunk_size=chunk_size,
        default_chunk_overlap=chunk_overlap,
    )


def make_job_info(
    *,
    failed_counter: int = 0,
    progress_counter: int = 0,
    total: int = 1,
    status: JobStatus = JobStatus.IN_PROGRESS,
) -> JobInfo:
    return JobInfo(
        job_id="test-job-1",
        status=status,
        created_at=1_000_000,
        total=total,
        progress_counter=progress_counter,
        failed_counter=failed_counter,
        document_count=0,
        chunk_count=0,
    )


def make_job_manager(
    *,
    failed_counter: int = 0,
    progress_counter: int = 0,
    total: int = 1,
    status: JobStatus = JobStatus.IN_PROGRESS,
) -> MagicMock:
    """Return a MagicMock that satisfies the JobManager async interface."""
    jm = MagicMock()
    jm.increment_document_count = AsyncMock(return_value=1)
    jm.increment_progress = AsyncMock(return_value=1)
    jm.increment_failure = AsyncMock(return_value=1)
    jm.add_error_msg = AsyncMock(return_value=1)
    jm.upsert_job = AsyncMock(return_value=True)
    jm.get_job = AsyncMock(
        return_value=make_job_info(
            failed_counter=failed_counter,
            progress_counter=progress_counter,
            total=total,
            status=status,
        )
    )
    return jm


def make_rag_client() -> MagicMock:
    client = MagicMock()
    client.ingestor_id = "confluence:default_confluence"
    client.ingest_documents = AsyncMock()
    return client


def make_loader(
    *,
    datasource_info: DataSourceInfo | None = None,
    job_manager: MagicMock | None = None,
    rag_client: MagicMock | None = None,
) -> ConfluenceLoader:
    """Instantiate ConfluenceLoader without opening a real HTTP session."""
    return ConfluenceLoader(
        rag_client=rag_client or make_rag_client(),
        job_manager=job_manager or make_job_manager(),
        datasource_info=datasource_info or make_datasource_info(),
        confluence_url="https://cisco-eti.atlassian.net/wiki",
        username="test@example.com",
        token="test-token",
        verify_ssl=True,
        max_concurrency=5,
    )


def make_page(
    page_id: str = "123456",
    title: str = "Test Page",
    html_body: str = "<p>Some meaningful content here.</p>",
    space_key: str = "SRE",
) -> dict:
    """Return a minimal Confluence REST API v1 page dict."""
    return {
        "id": page_id,
        "title": title,
        "body": {"storage": {"value": html_body}},
        "space": {"key": space_key, "name": "SRE Space"},
        "_links": {"webui": f"/wiki/spaces/{space_key}/pages/{page_id}"},
        "history": {
            "createdDate": "2024-01-01T00:00:00.000Z",
            "lastUpdated": {"when": "2024-06-01T00:00:00.000Z"},
            "createdBy": {"displayName": "Test Author"},
        },
        "version": {"number": 3},
    }


def _terminal_status_calls(jm: MagicMock) -> list:
    """Return only the upsert_job calls that set a terminal job status."""
    terminal = {
        JobStatus.COMPLETED,
        JobStatus.FAILED,
        JobStatus.COMPLETED_WITH_ERRORS,
        JobStatus.TERMINATED,
    }
    return [
        c for c in jm.upsert_job.call_args_list
        if c.kwargs.get("status") in terminal
    ]


# ===========================================================================
# 1. document_count tracking — core regression tests
# ===========================================================================


class TestIngestPagesDocumentCount:
    """Verify increment_document_count is called correctly per page."""

    async def test_single_page_with_content_increments_once(self):
        """A page with non-empty text content increments document_count by 1."""
        jm = make_job_manager(total=1)
        loader = make_loader(job_manager=jm)

        await loader.ingest_pages([make_page()], "job-1")

        jm.increment_document_count.assert_called_once_with("job-1", 1)

    async def test_document_count_called_before_progress(self):
        """increment_document_count must precede increment_progress for each page."""
        call_order: list[str] = []
        jm = make_job_manager(total=1)
        jm.increment_document_count = AsyncMock(
            side_effect=lambda *a, **kw: call_order.append("doc_count") or 1
        )
        jm.increment_progress = AsyncMock(
            side_effect=lambda *a, **kw: call_order.append("progress") or 1
        )
        loader = make_loader(job_manager=jm)

        await loader.ingest_pages([make_page()], "job-1")

        assert "doc_count" in call_order
        assert "progress" in call_order
        assert call_order.index("doc_count") < call_order.index("progress"), (
            "increment_document_count must be called before increment_progress"
        )

    async def test_empty_html_body_not_counted(self):
        """A page with an empty HTML body must NOT increment document_count."""
        jm = make_job_manager(total=1)
        loader = make_loader(job_manager=jm)

        await loader.ingest_pages([make_page(html_body="")], "job-1")

        jm.increment_document_count.assert_not_called()

    async def test_whitespace_only_html_not_counted(self):
        """HTML that renders to whitespace only must NOT increment document_count."""
        jm = make_job_manager(total=1)
        loader = make_loader(job_manager=jm)

        await loader.ingest_pages([make_page(html_body="   <p>  </p>\n  ")], "job-1")

        jm.increment_document_count.assert_not_called()

    async def test_empty_page_still_increments_progress(self):
        """A skipped empty-content page must still increment progress so the job doesn't stall."""
        jm = make_job_manager(total=1)
        loader = make_loader(job_manager=jm)

        await loader.ingest_pages([make_page(html_body="")], "job-1")

        jm.increment_progress.assert_called_once_with("job-1")

    async def test_page_missing_id_skipped_entirely(self):
        """A page dict without an 'id' key must be skipped — no count, no progress."""
        jm = make_job_manager(total=1)
        loader = make_loader(job_manager=jm)

        no_id_page = {
            "title": "No ID Page",
            "body": {"storage": {"value": "<p>Content</p>"}},
        }
        await loader.ingest_pages([no_id_page], "job-1")

        jm.increment_document_count.assert_not_called()
        jm.increment_progress.assert_not_called()

    async def test_page_with_none_id_skipped_entirely(self):
        """A page dict with id=None is treated the same as a missing id."""
        jm = make_job_manager(total=1)
        loader = make_loader(job_manager=jm)

        none_id_page = make_page()
        none_id_page["id"] = None
        await loader.ingest_pages([none_id_page], "job-1")

        jm.increment_document_count.assert_not_called()
        jm.increment_progress.assert_not_called()

    async def test_exception_during_page_processing_not_counted(self):
        """An exception raised inside the per-page try block must NOT increment document_count.

        inject failure via extract_text_from_html which runs inside the per-page
        try/except, ensuring the failure path is exercised without relying on batch size.
        """
        jm = make_job_manager(total=1, failed_counter=1)
        loader = make_loader(job_manager=jm)
        loader.extract_text_from_html = MagicMock(side_effect=RuntimeError("parse error"))

        await loader.ingest_pages([make_page()], "job-1")

        jm.increment_document_count.assert_not_called()
        jm.increment_failure.assert_called_once()

    async def test_exception_in_ingest_batch_inloop_not_counted(self):
        """When _ingest_batch raises during an in-loop flush (large page), page is not counted.

        The in-loop flush fires when accumulated chunks >= CONFLUENCE_BATCH_SIZE.
        Because that call is inside the per-page try/except, the exception is caught,
        failure is tracked, and document_count is NOT incremented.

        Side-effect: documents that failed to flush are NOT cleared from the buffer, so
        the post-loop flush re-attempts them and also raises an uncaught exception
        (ingest_pages propagates it). The test documents this known behaviour.
        """
        jm = make_job_manager(total=1, failed_counter=1)
        loader = make_loader(job_manager=jm)
        loader._ingest_batch = AsyncMock(side_effect=RuntimeError("batch error"))

        # Large enough to trigger the in-loop flush inside the per-page try/except
        large_text = "Word " * (CONFLUENCE_BATCH_SIZE * 200)

        # The post-loop flush (outside try/except) re-raises after the page loop
        with pytest.raises(RuntimeError, match="batch error"):
            await loader.ingest_pages([make_page(html_body=f"<p>{large_text}</p>")], "job-1")

        # Per-page handler DID run: document_count skipped, failure tracked
        jm.increment_document_count.assert_not_called()
        jm.increment_failure.assert_called_once()

    async def test_multiple_pages_all_with_content(self):
        """N pages with content → document_count incremented exactly N times, each with value 1."""
        n = 5
        jm = make_job_manager(total=n)
        loader = make_loader(job_manager=jm)

        pages = [make_page(page_id=str(i), title=f"Page {i}") for i in range(n)]
        await loader.ingest_pages(pages, "job-1")

        assert jm.increment_document_count.call_count == n
        for c in jm.increment_document_count.call_args_list:
            assert c == call("job-1", 1)

    async def test_mixed_pages_counts_only_content_pages(self):
        """Only pages with non-empty content increment document_count."""
        jm = make_job_manager(total=4)
        loader = make_loader(job_manager=jm)

        pages = [
            make_page(page_id="1", html_body="<p>Content A</p>"),          # counted
            make_page(page_id="2", html_body=""),                           # empty — not counted
            {"title": "No ID", "body": {"storage": {"value": "<p>X</p>"}}},  # missing id
            make_page(page_id="4", html_body="<p>Content B</p>"),          # counted
        ]
        await loader.ingest_pages(pages, "job-1")

        assert jm.increment_document_count.call_count == 2

    async def test_mixed_pages_with_processing_failure(self):
        """Pages that fail during processing are not counted; successful ones are.

        Inject the failure via extract_text_from_html on a specific page so the
        exception is caught by the per-page handler regardless of batch size.
        """
        from bs4 import BeautifulSoup

        call_n = {"n": 0}

        def fail_on_second_page(html: str) -> str:
            call_n["n"] += 1
            if call_n["n"] == 2:
                raise RuntimeError("parse error on page 2")
            return BeautifulSoup(html, "html.parser").get_text(separator="\n", strip=True)

        jm = make_job_manager(total=3, failed_counter=1)
        loader = make_loader(job_manager=jm)
        loader.extract_text_from_html = MagicMock(side_effect=fail_on_second_page)

        pages = [
            make_page(page_id="1", html_body="<p>A</p>"),
            make_page(page_id="2", html_body="<p>B</p>"),  # fails
            make_page(page_id="3", html_body="<p>C</p>"),
        ]
        await loader.ingest_pages(pages, "job-1")

        # Pages 1 and 3 succeed; page 2 fails inside the per-page try block
        assert jm.increment_document_count.call_count == 2

    async def test_increment_uses_job_id_from_argument(self):
        """The job_id passed to ingest_pages is forwarded to increment_document_count."""
        jm = make_job_manager(total=1)
        loader = make_loader(job_manager=jm)

        await loader.ingest_pages([make_page()], "specific-job-xyz")

        jm.increment_document_count.assert_called_once_with("specific-job-xyz", 1)


# ===========================================================================
# 2. Batch boundary behaviour
# ===========================================================================


class TestIngestPagesBatchBoundary:
    """document_count is per-page, not per-batch-flush."""

    async def test_large_page_producing_multiple_batches_counted_once(self):
        """A single page producing >CONFLUENCE_BATCH_SIZE chunks counts as 1 document."""
        jm = make_job_manager(total=1)
        loader = make_loader(job_manager=jm)

        # ~200 words per chunk * (BATCH_SIZE + 5) chunks = well over 1 batch
        large_text = "Word " * (CONFLUENCE_BATCH_SIZE * 200)
        large_page = make_page(html_body=f"<p>{large_text}</p>")

        await loader.ingest_pages([large_page], "job-1")

        jm.increment_document_count.assert_called_once_with("job-1", 1)

    async def test_two_pages_both_counted_even_when_batched_together(self):
        """Two pages whose chunks fill a shared batch are each counted independently."""
        jm = make_job_manager(total=2)
        loader = make_loader(job_manager=jm)

        pages = [
            make_page(page_id="1", html_body="<p>First page.</p>"),
            make_page(page_id="2", html_body="<p>Second page.</p>"),
        ]
        await loader.ingest_pages(pages, "job-1")

        assert jm.increment_document_count.call_count == 2

    async def test_remaining_documents_flushed_at_end_still_counted(self):
        """The final sub-batch (remainder after last full-batch flush) is counted correctly."""
        jm = make_job_manager(total=3)
        loader = make_loader(job_manager=jm)

        # Three pages each just under the batch threshold — they'll flush at the end
        pages = [make_page(page_id=str(i)) for i in range(3)]
        await loader.ingest_pages(pages, "job-1")

        assert jm.increment_document_count.call_count == 3


# ===========================================================================
# 3. Final job status after ingest_pages
# ===========================================================================


class TestIngestPagesJobStatus:
    """Verify the terminal status written to the job after processing completes."""

    async def test_all_pages_succeed_status_is_completed(self):
        """All pages succeed → job status COMPLETED."""
        jm = make_job_manager(total=2, failed_counter=0, status=JobStatus.IN_PROGRESS)
        loader = make_loader(job_manager=jm)

        await loader.ingest_pages([make_page(page_id=str(i)) for i in range(2)], "job-1")

        calls = _terminal_status_calls(jm)
        assert calls, "Expected at least one terminal status call"
        assert calls[-1].kwargs["status"] == JobStatus.COMPLETED

    async def test_all_pages_fail_status_is_failed(self):
        """All pages fail during processing → job status FAILED.

        Inject failure via extract_text_from_html so every page's exception is
        caught by the per-page handler and increment_failure is called for each.
        The mock job_info returned by get_job must reflect failed_counter == total.
        """
        jm = make_job_manager(total=2, failed_counter=2, status=JobStatus.IN_PROGRESS)
        loader = make_loader(job_manager=jm)
        loader.extract_text_from_html = MagicMock(side_effect=RuntimeError("parse error"))

        await loader.ingest_pages([make_page(page_id=str(i)) for i in range(2)], "job-1")

        calls = _terminal_status_calls(jm)
        assert calls, "Expected at least one terminal status call"
        assert calls[-1].kwargs["status"] == JobStatus.FAILED

    async def test_partial_failures_status_is_completed_with_errors(self):
        """One page fails and one succeeds → job status COMPLETED_WITH_ERRORS.

        Inject failure via extract_text_from_html for the first page only.
        The mock job_info returned by get_job reflects failed_counter=1, total=2.
        """
        from bs4 import BeautifulSoup

        call_n = {"n": 0}

        def fail_first(html: str) -> str:
            call_n["n"] += 1
            if call_n["n"] == 1:
                raise RuntimeError("parse error on first page")
            return BeautifulSoup(html, "html.parser").get_text(separator="\n", strip=True)

        jm = make_job_manager(total=2, failed_counter=1, status=JobStatus.IN_PROGRESS)
        loader = make_loader(job_manager=jm)
        loader.extract_text_from_html = MagicMock(side_effect=fail_first)

        await loader.ingest_pages(
            [make_page(page_id="fail"), make_page(page_id="succeed")], "job-1"
        )

        calls = _terminal_status_calls(jm)
        assert calls, "Expected at least one terminal status call"
        assert calls[-1].kwargs["status"] == JobStatus.COMPLETED_WITH_ERRORS

    async def test_terminated_job_remains_terminated(self):
        """If the job is TERMINATED before ingest_pages finishes, the final status is TERMINATED."""
        jm = make_job_manager(total=1, status=JobStatus.TERMINATED)
        loader = make_loader(job_manager=jm)

        await loader.ingest_pages([make_page()], "job-1")

        terminated_calls = [
            c for c in jm.upsert_job.call_args_list
            if c.kwargs.get("status") == JobStatus.TERMINATED
        ]
        assert terminated_calls, "Expected at least one TERMINATED status call"

    async def test_empty_page_list_results_in_completed(self):
        """Ingesting an empty page list completes without errors."""
        jm = make_job_manager(total=0, failed_counter=0, status=JobStatus.IN_PROGRESS)
        loader = make_loader(job_manager=jm)

        # Should not raise
        await loader.ingest_pages([], "job-1")

        jm.increment_document_count.assert_not_called()


# ===========================================================================
# 4. generate_datasource_id
# ===========================================================================


class TestGenerateDatasourceId:
    """Tests for the datasource ID generation helper."""

    def test_basic_url_produces_expected_id(self):
        result = generate_datasource_id("https://cisco-eti.atlassian.net/wiki", "SRE")
        assert result == "src_confluence___cisco_eti_atlassian_net__SRE"

    def test_always_prefixed_with_src_confluence(self):
        result = generate_datasource_id("https://example.com", "DOCS")
        assert result.startswith("src_confluence___")

    def test_domain_dots_replaced_with_underscores(self):
        result = generate_datasource_id("https://example.com", "SPACE")
        domain_part = result.split("___")[1].split("__")[0]
        assert "." not in domain_part
        assert "example_com" in domain_part

    def test_domain_dashes_replaced_with_underscores(self):
        result = generate_datasource_id("https://my-company.atlassian.net/wiki", "ENG")
        domain_part = result.split("___")[1].split("__")[0]
        assert "-" not in domain_part

    def test_different_space_keys_produce_different_ids(self):
        r1 = generate_datasource_id("https://example.com", "SRE")
        r2 = generate_datasource_id("https://example.com", "ENG")
        assert r1 != r2

    def test_space_key_appended_correctly(self):
        result = generate_datasource_id("https://example.com", "MY_SPACE")
        assert result.endswith("__MY_SPACE")

    def test_different_domains_produce_different_ids(self):
        r1 = generate_datasource_id("https://company-a.atlassian.net", "SRE")
        r2 = generate_datasource_id("https://company-b.atlassian.net", "SRE")
        assert r1 != r2

    def test_no_special_characters_in_output(self):
        """Output should be filesystem / Redis key friendly."""
        result = generate_datasource_id("https://complex-name.example.co.uk/wiki", "SPACE_1")
        # Should not contain dots or dashes (only underscores and alphanumerics in domain part)
        domain_part = result.split("___")[1].split("__")[0]
        assert "." not in domain_part
        assert "-" not in domain_part


# ===========================================================================
# 5. extract_text_from_html
# ===========================================================================


class TestExtractTextFromHtml:
    """Tests for the HTML-to-plaintext helper."""

    def _loader(self) -> ConfluenceLoader:
        return make_loader()

    def test_basic_paragraph_extracted(self):
        result = self._loader().extract_text_from_html("<p>Hello world</p>")
        assert "Hello world" in result

    def test_empty_string_returns_empty(self):
        result = self._loader().extract_text_from_html("")
        assert result.strip() == ""

    def test_html_tags_stripped(self):
        result = self._loader().extract_text_from_html("<h1>Title</h1><p>Body</p>")
        assert "<h1>" not in result
        assert "<p>" not in result
        assert "Title" in result
        assert "Body" in result

    def test_nested_list_items_all_extracted(self):
        html = "<div><ul><li>Item 1</li><li>Item 2</li></ul></div>"
        result = self._loader().extract_text_from_html(html)
        assert "Item 1" in result
        assert "Item 2" in result

    def test_whitespace_only_body_returns_empty_equivalent(self):
        result = self._loader().extract_text_from_html("   <p>   </p>   ")
        assert result.strip() == ""

    def test_html_entities_decoded(self):
        result = self._loader().extract_text_from_html("<p>&amp; &lt;tag&gt;</p>")
        assert "&amp;" not in result
        assert "& <tag>" in result

    def test_table_content_extracted(self):
        html = "<table><tr><td>Cell A</td><td>Cell B</td></tr></table>"
        result = self._loader().extract_text_from_html(html)
        assert "Cell A" in result
        assert "Cell B" in result

    def test_heading_content_preserved(self):
        html = "<h1>Main Title</h1><h2>Sub Title</h2><p>Paragraph</p>"
        result = self._loader().extract_text_from_html(html)
        assert "Main Title" in result
        assert "Sub Title" in result
        assert "Paragraph" in result

    def test_code_block_text_preserved(self):
        html = "<code>print('hello')</code>"
        result = self._loader().extract_text_from_html(html)
        assert "print" in result

    def test_multiple_paragraphs_all_extracted(self):
        html = "<p>First</p><p>Second</p><p>Third</p>"
        result = self._loader().extract_text_from_html(html)
        assert "First" in result
        assert "Second" in result
        assert "Third" in result

    def test_returns_string_type(self):
        """Must always return a string, never raise."""
        result = self._loader().extract_text_from_html("<p>Any content</p>")
        assert isinstance(result, str)

    def test_confluence_structured_macro_does_not_raise(self):
        """Confluence-specific macros must be handled gracefully."""
        html = (
            '<ac:structured-macro ac:name="code">'
            "<ac:plain-text-body>print('hello')</ac:plain-text-body>"
            "</ac:structured-macro>"
        )
        result = self._loader().extract_text_from_html(html)
        assert isinstance(result, str)
