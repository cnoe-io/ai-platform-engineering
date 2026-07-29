from unittest import TestCase

from tome_agent.reports import schema


class TrackedEntitySchemaTest(TestCase):
    def test_issue_lifecycle_and_rollup_fields_are_prompted(self) -> None:
        self.assertEqual(
            schema.ISSUE_STATUSES,
            ("open", "in_progress", "resolved"),
        )
        self.assertEqual(
            schema.TRACKED_ENTITY_PRIORITIES,
            ("critical", "high", "medium", "low"),
        )
        self.assertIn(schema.FM_PRIORITY, schema.ISSUE_FRONTMATTER)
        self.assertIn(schema.FM_TARGET, schema.ISSUE_FRONTMATTER)
        self.assertIn(schema.FM_CLOSED, schema.ISSUE_FRONTMATTER)

    def test_decision_lifecycle_remains_explicit(self) -> None:
        self.assertEqual(
            schema.DECISION_STATUSES,
            ("proposed", "accepted", "rejected"),
        )
        self.assertIn(schema.FM_PRIORITY, schema.DECISION_FRONTMATTER)
        self.assertIn(schema.FM_TARGET, schema.DECISION_FRONTMATTER)
