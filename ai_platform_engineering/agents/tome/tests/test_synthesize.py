import json
from unittest import TestCase
from unittest.mock import patch

from tome_agent.agent.connectors.base import SourceItem
from tome_agent.agent.connectors.confluence import ConfluenceConnector
from tome_agent.agent.mcp_confluence import (
    _bound_tree_page_bodies,
    _search_page_params,
    _storage_to_text,
    _tree_result,
)
from tome_agent.agent.synthesize import _build_synthesis_system_prompt
from tome_agent.orchestrator.contract import (
    ChildProjectSnapshot,
    ConfluencePageScopeSnapshot,
    ConfluenceSpaceSnapshot,
    ProjectSnapshot,
    RepoSnapshot,
    WebexRoomSnapshot,
)


class SynthesisSourcePromptTest(TestCase):
    def test_confluence_tree_stays_inline_and_keeps_every_page(self) -> None:
        pages = [
            {
                "id": str(index),
                "title": f"Page {index}",
                "parent_id": None,
                "depth": 0,
                "url": f"https://example.test/wiki/pages/{index}",
                "body": _storage_to_text(f"<p>{'x' * 3_200}</p>"),
            }
            for index in range(75)
        ]
        result = _tree_result(
            space_key="EXAMPLE",
            root_page_id="0",
            pages=pages,
            tree_truncated=False,
            site_url="https://example.atlassian.net",
        )
        payload = json.loads(result["content"][0]["text"])
        id_index = payload["page_fields"].index("id")
        body_index = payload["page_fields"].index("body")

        self.assertLess(len(result["content"][0]["text"].encode()), 50_000)
        self.assertEqual(payload["total_pages"], 75)
        self.assertEqual(
            [page[id_index] for page in payload["pages"]],
            [str(i) for i in range(75)],
        )
        self.assertTrue(all(page[body_index] for page in payload["pages"]))
        self.assertEqual(payload["included_body_chars"], 31_950)
        self.assertEqual(
            payload["page_url_template"],
            "https://example.atlassian.net/wiki/pages/{id}",
        )

    def test_confluence_max_tree_stays_in_one_bounded_result(self) -> None:
        pages = [
            {
                "id": str(index),
                "title": f"Example page {index:03d}",
                "parent_id": str(index - 1) if index else None,
                "depth": index % 5,
                "last_modified": "2026-07-30T11:30:00.000Z",
                "body": "x" * 3_200,
            }
            for index in range(500)
        ]

        result = _tree_result(
            space_key="EXAMPLE",
            root_page_id="0",
            pages=pages,
            tree_truncated=False,
        )
        payload = json.loads(result["content"][0]["text"])

        self.assertLess(len(result["content"][0]["text"].encode()), 100_000)
        self.assertEqual(payload["total_pages"], 500)
        self.assertEqual(len(payload["pages"]), 500)

    def test_confluence_storage_body_becomes_readable_text(self) -> None:
        storage = "<h2>Plan</h2><p>First&nbsp;item</p><ul><li>Next</li></ul>"

        self.assertEqual(_storage_to_text(storage), "Plan\nFirst item\nNext")

    def test_confluence_search_pagination_preserves_cursor(self) -> None:
        params = _search_page_params(
            cql="ancestor=123 and type=page",
            expand="content.ancestors",
            limit=50,
            next_link=(
                "/rest/api/search?limit=50&cursor=opaque-token"
                "&cql=ancestor%3D123%20and%20type%3Dpage"
                "&expand=content.ancestors"
            ),
        )

        self.assertEqual(params["cursor"], "opaque-token")
        self.assertEqual(params["cql"], "ancestor=123 and type=page")
        self.assertEqual(params["expand"], "content.ancestors")
        self.assertEqual(params["limit"], "50")

    def test_confluence_tree_content_budget_keeps_every_page(self) -> None:
        pages = [
            {"id": "1", "body": "a" * 20},
            {"id": "2", "body": "b" * 20},
            {"id": "3", "body": "c" * 20},
        ]

        included_chars, truncated_pages = _bound_tree_page_bodies(
            pages,
            total_budget=12,
            per_page_limit=10,
        )

        self.assertEqual(included_chars, 12)
        self.assertEqual(truncated_pages, 3)
        self.assertEqual([page["body"] for page in pages], ["a" * 4, "b" * 4, "c" * 4])
        self.assertTrue(all(page["body_truncated"] for page in pages))

    def test_bhag_and_area_prompts_include_direct_sources(self) -> None:
        for project_type in ("bhag", "area"):
            with self.subTest(project_type=project_type):
                snapshot = ProjectSnapshot(
                    project_id=f"{project_type}-id",
                    slug=f"{project_type}-example",
                    name=f"{project_type} example",
                    project_type=project_type,
                    repos=[
                        RepoSnapshot(
                            slug="repository",
                            url="https://github.com/example/repository",
                        )
                    ],
                    confluence_spaces=[
                        ConfluenceSpaceSnapshot(
                            slug="example-space",
                            name="Example space",
                            space_key="EXAMPLE",
                            base_url="https://example.atlassian.net",
                        )
                    ],
                    webex_rooms=[
                        WebexRoomSnapshot(
                            slug="example-room",
                            name="Example room",
                            room_id="room-id",
                        )
                    ],
                    child_projects=[
                        ChildProjectSnapshot(
                            project_id="child-id",
                            slug="child-example",
                            name="Child example",
                        )
                    ],
                )

                prompt = _build_synthesis_system_prompt(
                    snapshot,
                    is_greenfield=False,
                    seed_stable_pages=False,
                )

                self.assertIn("DIRECTLY ATTACHED SOURCES", prompt)
                self.assertIn("repos/repository", prompt)
                self.assertIn("confluence/example-space", prompt)
                self.assertIn("webex/example-room", prompt)
                self.assertIn("issues/*.md", prompt)
                self.assertIn("decisions/*.md", prompt)
                self.assertIn("priority is `critical`", prompt)
                self.assertNotIn("has NO repos", prompt)

    def test_confluence_page_scope_uses_page_tree(self) -> None:
        prompt = ConfluenceConnector().system_prompt_block(
            [
                SourceItem(
                    slug="example-space",
                    display_name="Example space",
                    extra={
                        "space_key": "EXAMPLE",
                        "base_url": "https://example.atlassian.net",
                        "root_page_id": "123",
                        "root_page_title": "Overview",
                        "include_descendants": True,
                    },
                )
            ]
        )

        self.assertIn("page_id=123 (Overview)", prompt)
        self.assertIn("this page and all descendants", prompt)
        self.assertIn("confluence_get_page_tree(page_id=<PAGE_ID>)", prompt)
        self.assertIn("single compact result contains ALL pages", prompt)
        self.assertIn("Use EVERY returned row", prompt)
        self.assertIn("NEVER call `confluence_get_pages`", prompt)
        self.assertIn("do not scan unrelated pages", prompt)

    @patch("tome_agent.agent.connectors.confluence.build_confluence_mcp")
    def test_confluence_page_scopes_lock_mcp_to_saved_roots(self, build_mcp) -> None:
        source = SourceItem(
            slug="example-space",
            display_name="Example space",
            extra={
                "space_key": "EXAMPLE",
                "base_url": "https://example.atlassian.net",
                "page_scopes": [
                    {
                        "page_id": "123",
                        "page_title": "Overview",
                        "include_descendants": True,
                    }
                ],
            },
        )

        ConfluenceConnector().build_mcp(token="token", sources=[source])

        self.assertEqual(
            build_mcp.call_args.kwargs["page_scoped_space_keys"], ["EXAMPLE"]
        )
        self.assertEqual(build_mcp.call_args.kwargs["selected_root_page_ids"], ["123"])

    def test_confluence_multiple_page_scopes_use_each_root(self) -> None:
        prompt = ConfluenceConnector().system_prompt_block(
            [
                SourceItem(
                    slug="example-space",
                    display_name="Example space",
                    extra={
                        "space_key": "EXAMPLE",
                        "page_scopes": [
                            {
                                "page_id": "123",
                                "page_title": "Overview",
                                "include_descendants": True,
                            },
                            {
                                "page_id": "456",
                                "page_title": "Runbook",
                                "include_descendants": False,
                            },
                        ],
                    },
                )
            ]
        )

        self.assertIn("page_id=123 (Overview)", prompt)
        self.assertIn("page_id=456 (Runbook)", prompt)
        self.assertIn("read this page only", prompt)
        self.assertIn("exactly once", prompt)

        snapshot = ConfluenceSpaceSnapshot(
            slug="example-space",
            name="Example space",
            space_key="EXAMPLE",
            page_scopes=[
                ConfluencePageScopeSnapshot(
                    page_id="123",
                    page_title="Overview",
                )
            ],
        )
        self.assertEqual(snapshot.page_scopes[0].page_id, "123")
