import asyncio
from unittest import TestCase
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from tome_agent.agent.connectors.github import GitHubExtra
from tome_agent.agent.ingestor import write_verbatim_pages


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class WriteVerbatimPagesTest(TestCase):
    def test_writes_each_page_with_mirror_frontmatter_and_title_cased_name(self) -> None:
        extras = {
            "github": GitHubExtra(
                verbatim_pages=[("widgets", "release-notes", "Body text.\n", "sha123")]
            )
        }
        report_id = uuid4()

        with patch("tome_agent.agent.ingestor.http_client.write_page", new=AsyncMock()) as write_page:
            events = _run(
                write_verbatim_pages(extras, report_id=report_id, project_id="proj-1")
            )

        write_page.assert_awaited_once()
        kwargs = write_page.await_args.kwargs
        self.assertEqual(kwargs["page_path"], "repos/widgets/release-notes.md")
        self.assertEqual(kwargs["author"], "ttt-pipeline")
        self.assertEqual(kwargs["report_id"], report_id)
        self.assertEqual(kwargs["project_id"], "proj-1")
        self.assertIn("title: Release Notes\n", kwargs["body"])
        self.assertIn("kind: dynamic\n", kwargs["body"])
        self.assertIn("mirror: true\n", kwargs["body"])
        self.assertIn("source_repo: widgets\n", kwargs["body"])
        self.assertIn("source_path: .tome/pages/release-notes.md\n", kwargs["body"])
        self.assertIn("source_sha: sha123\n", kwargs["body"])
        self.assertTrue(kwargs["body"].endswith("Body text.\n"))

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].type, "page_written")
        self.assertEqual(events[0].data["path"], "repos/widgets/release-notes.md")

    def test_no_github_extra_is_a_no_op(self) -> None:
        with patch("tome_agent.agent.ingestor.http_client.write_page", new=AsyncMock()) as write_page:
            events = _run(
                write_verbatim_pages({}, report_id=uuid4(), project_id="proj-1")
            )
        write_page.assert_not_awaited()
        self.assertEqual(events, [])

    def test_a_failed_write_is_skipped_but_does_not_crash_the_run(self) -> None:
        extras = {
            "github": GitHubExtra(
                verbatim_pages=[
                    ("widgets", "bad", "x", "sha1"),
                    ("widgets", "good", "y", "sha2"),
                ]
            )
        }

        async def write_page_side_effect(*, page_path, **kwargs):
            if "bad" in page_path:
                raise RuntimeError("backend unavailable")

        with patch(
            "tome_agent.agent.ingestor.http_client.write_page",
            new=AsyncMock(side_effect=write_page_side_effect),
        ):
            events = _run(
                write_verbatim_pages(extras, report_id=uuid4(), project_id="proj-1")
            )

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].data["path"], "repos/widgets/good.md")
