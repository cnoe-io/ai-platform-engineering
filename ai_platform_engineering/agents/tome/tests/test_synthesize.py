from unittest import TestCase

from tome_agent.agent.synthesize import _build_synthesis_system_prompt
from tome_agent.orchestrator.contract import (
    ChildProjectSnapshot,
    ConfluenceSpaceSnapshot,
    ProjectSnapshot,
    RepoSnapshot,
    WebexRoomSnapshot,
)


class SynthesisSourcePromptTest(TestCase):
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
