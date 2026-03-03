#!/usr/bin/env python3
"""Add frontmatter title with date (YYYY-MM-DD: ...) to each change doc for sidebar display."""
import re
from pathlib import Path

CHANGES_DIR = Path(__file__).resolve().parent.parent / "docs" / "changes"


def get_first_heading(content: str) -> str | None:
    for line in content.splitlines():
        s = line.strip()
        if s.startswith("# "):
            return s[2:].strip()
    return None


def extract_date_from_filename(filename: str) -> str | None:
    m = re.match(r"^(\d{4}-\d{2}-\d{2})-", filename)
    return m.group(1) if m else None


def ensure_title_in_frontmatter(filepath: Path, date: str, heading: str) -> None:
    title_value = f"{date}: {heading}"
    raw = filepath.read_text(encoding="utf-8")

    if raw.startswith("---"):
        end = raw.index("---", 3)
        if end == -1:
            return
        fm = raw[4:end]
        body = raw[end + 3 :].lstrip("\n")

        if re.search(r"^title\s*:", fm, re.MULTILINE):
            fm = re.sub(r"^title\s*:\s*.*$", f'title: "{title_value}"', fm, count=1, flags=re.MULTILINE)
        else:
            fm = fm.rstrip() + "\n" + f'title: "{title_value}"\n'

        new_content = "---\n" + fm + "---\n\n" + body
    else:
        new_content = f'---\ntitle: "{title_value}"\n---\n\n' + raw

    filepath.write_text(new_content, encoding="utf-8")


def main() -> None:
    for f in sorted(CHANGES_DIR.glob("202*.md")):
        date = extract_date_from_filename(f.name)
        if not date:
            continue
        content = f.read_text(encoding="utf-8")
        if content.startswith("---"):
            end = content.index("---", 3)
            body = content[end + 3 :]
        else:
            body = content
        heading = get_first_heading(body)
        if not heading:
            print(f"  skip (no # heading): {f.name}")
            continue
        ensure_title_in_frontmatter(f, date, heading)
        print(f"  ok: {f.name}")


if __name__ == "__main__":
    main()
