"""Tests for Dynamic Agents skill file data construction."""

from dynamic_agents.services.skills import build_skills_files


def test_build_skills_files_uses_deepagents_v2_file_data() -> None:
    files, sources = build_skills_files(
        [
            {
                "id": "example-skill",
                "name": "Example Skill",
                "description": "Example description",
                "content": "Use this skill.\nIt has multiple lines.",
                "source": "default",
                "ancillary_files": {"notes.txt": "Ancillary\ncontent"},
            }
        ]
    )

    assert sources == ["/skills/default/"]

    skill_file = files["/skills/default/example-skill/SKILL.md"]
    assert isinstance(skill_file["content"], str)
    assert skill_file["encoding"] == "utf-8"
    assert "Use this skill.\nIt has multiple lines." in skill_file["content"]

    ancillary_file = files["/skills/default/example-skill/notes.txt"]
    assert ancillary_file["content"] == "Ancillary\ncontent"
    assert ancillary_file["encoding"] == "utf-8"
