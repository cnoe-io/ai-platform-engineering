from unittest import TestCase

from tome_agent.agent import drift
from tome_agent.reports import schema


class ClassifyStructuralTest(TestCase):
    def setUp(self) -> None:
        schema.set_template_overrides(None, {"top-level": 3})
        self.addCleanup(schema.set_template_overrides, None, None)
        self.expected = schema.expected_template_pages(schema.default_pages(), {})

    def test_bound_current_page(self) -> None:
        pages = {
            "architecture.md": (
                "---\ntitle: Architecture\nkind: dynamic\n"
                "template_scope: top-level\ntemplate_path: architecture.md\n"
                "template_version: 3\n---\nbody\n"
            )
        }
        report = {p.path: p for p in drift.classify_structural(pages, self.expected)}
        self.assertEqual(report["architecture.md"].status, "current")

    def test_bound_version_behind_page(self) -> None:
        pages = {
            "architecture.md": (
                "---\ntitle: Architecture\nkind: dynamic\n"
                "template_scope: top-level\ntemplate_path: architecture.md\n"
                "template_version: 1\n---\nbody\n"
            )
        }
        report = {p.path: p for p in drift.classify_structural(pages, self.expected)}
        self.assertEqual(report["architecture.md"].status, "version_behind")
        self.assertEqual(report["architecture.md"].seeded_version, 1)
        self.assertEqual(report["architecture.md"].live_version, 3)

    def test_unbound_page_is_not_flagged_as_missing(self) -> None:
        pages = {"my-notes.md": "---\ntitle: My Notes\nkind: dynamic\n---\nbody\n"}
        report = {p.path: p for p in drift.classify_structural(pages, self.expected)}
        self.assertEqual(report["my-notes.md"].status, "unbound")

    def test_explicit_null_scope_is_unbound(self) -> None:
        pages = {
            "my-notes.md": "---\ntitle: My Notes\nkind: dynamic\ntemplate_scope: null\n---\nbody\n"
        }
        report = {p.path: p for p in drift.classify_structural(pages, self.expected)}
        self.assertEqual(report["my-notes.md"].status, "unbound")

    def test_unbound_legacy_page_at_template_path_is_not_missing(self) -> None:
        # Regression: a pre-#488 page sitting at the exact template path,
        # with no template_scope frontmatter at all, must show as `unbound`
        # only — not ALSO as `missing`, just because nothing carries the
        # binding yet.
        pages = {"architecture.md": "---\ntitle: Architecture\nkind: dynamic\n---\nbody\n"}
        report = drift.classify_structural(pages, self.expected)
        statuses = [p.status for p in report if p.path == "architecture.md"]
        self.assertEqual(statuses, ["unbound"])

    def test_template_page_absent_from_disk_is_missing(self) -> None:
        report = drift.classify_structural({}, self.expected)
        statuses = {p.path: p.status for p in report}
        self.assertEqual(statuses["architecture.md"], "missing")
        self.assertEqual(statuses["charter.md"], "missing")

    def test_binding_matched_by_path_not_current_location(self) -> None:
        # Page physically renamed but still carries its original binding —
        # should NOT show up as missing, since binding match is by
        # (scope, template_path), not the page's current on-disk path.
        pages = {
            "renamed-architecture.md": (
                "---\ntitle: Architecture\nkind: dynamic\n"
                "template_scope: top-level\ntemplate_path: architecture.md\n"
                "template_version: 3\n---\nbody\n"
            )
        }
        report = drift.classify_structural(pages, self.expected)
        statuses = {p.path: p.status for p in report}
        self.assertNotIn("architecture.md", statuses)
        self.assertEqual(statuses["renamed-architecture.md"], "current")


class CheckContentDriftTest(TestCase):
    def test_noop_when_nothing_in_scope(self) -> None:
        import asyncio

        candidates = [drift.PageDrift(path="a.md", status="current")]
        asyncio.run(drift.check_content_drift(candidates, {}, {}))
        self.assertIsNone(candidates[0].drifted)

    def test_current_pages_are_not_checked_by_default(self) -> None:
        import asyncio
        from unittest.mock import AsyncMock, patch

        candidates = [drift.PageDrift(path="a.md", status="current")]
        with patch.object(drift, "_run_content_check", new=AsyncMock(return_value=([], None))) as mocked:
            asyncio.run(drift.check_content_drift(candidates, {}, {}, include_current=False))
        mocked.assert_not_called()

    def test_include_current_checks_already_current_pages_too(self) -> None:
        import asyncio
        from unittest.mock import AsyncMock, patch

        candidates = [
            drift.PageDrift(
                path="a.md", status="current", template_scope="top-level", template_path="a.md",
            )
        ]
        verdicts = [{"path": "a.md", "drifted": True, "reason": "hand-edited, no longer matches guidance"}]
        with patch.object(drift, "_run_content_check", new=AsyncMock(return_value=(verdicts, None))) as mocked:
            asyncio.run(drift.check_content_drift(candidates, {"a.md": "body"}, {}, include_current=True))
        mocked.assert_called_once()
        self.assertTrue(candidates[0].drifted)
        self.assertEqual(candidates[0].status, "current")
