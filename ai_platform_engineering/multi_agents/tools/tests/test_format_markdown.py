# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for the format_markdown tool.

Tests updated for string-based return format (simplified API).
Tools return formatted text directly or "ERROR: message" on failure.

Tests cover:
- Basic markdown formatting
- Validation without formatting
- Table formatting
- Heading consistency
- List formatting
- Code block handling
- Error handling
"""

import unittest
from ai_platform_engineering.multi_agents.tools.format_markdown import format_markdown


class TestFormatMarkdown(unittest.TestCase):
    """Test suite for format_markdown tool."""

    def test_basic_formatting(self):
        """Test basic markdown formatting."""
        # Messy markdown
        messy_md = """# Header

Some text with  extra   spaces.

- List item 1
-  List item 2

More text."""

        result = format_markdown.invoke({"markdown_text": messy_md, "validate_only": False})

        self.assertFalse(result.startswith("ERROR"))
        self.assertIsInstance(result, str)
        self.assertIn("Header", result)
        print("✓ Basic markdown formatting works")

    def test_validate_only_mode(self):
        """Test validation without formatting."""
        # Already formatted markdown
        good_md = """# Header

Some text.

- Item 1
- Item 2
"""

        result = format_markdown.invoke({"markdown_text": good_md, "validate_only": True})

        self.assertIn("VALIDATION", result)
        # Should report validation result
        print("✓ Validation mode works")

    def test_validate_only_with_issues(self):
        """Test validation detects formatting issues."""
        # Poorly formatted markdown
        bad_md = """#Header
Some text
-item
-  item"""

        result = format_markdown.invoke({"markdown_text": bad_md, "validate_only": True})

        self.assertIn("VALIDATION", result)
        self.assertIn("Issues detected", result)
        print("✓ Validation detects issues")

    def test_table_formatting(self):
        """Test table formatting and alignment."""
        # Messy table
        messy_table = """
| Header1|Header2 |Header3|
|---|:---|---:|
|Cell1| Cell2|Cell3 |
| A |B|  C|
"""

        result = format_markdown.invoke({"markdown_text": messy_table})

        self.assertFalse(result.startswith("ERROR"))
        # Table should be present
        self.assertIn("|", result)
        print("✓ Table formatting works")

    def test_heading_hierarchy(self):
        """Test proper heading formatting."""
        # Mixed heading styles
        text = """#Heading 1
##Heading 2
###  Heading 3

Some text."""

        result = format_markdown.invoke({"markdown_text": text})

        self.assertFalse(result.startswith("ERROR"))
        # Headings should have proper spacing
        self.assertIn("# ", result)
        print("✓ Heading formatting works")

    def test_code_block_preservation(self):
        """Test that code blocks are preserved correctly."""
        text = """Some text.

```python
def hello():
    print("world")
```

More text."""

        result = format_markdown.invoke({"markdown_text": text})

        self.assertFalse(result.startswith("ERROR"))
        # Code block should be preserved
        self.assertIn("```", result)
        self.assertIn("def hello", result)
        print("✓ Code block preservation works")

    def test_list_formatting(self):
        """Test list formatting consistency."""
        # Inconsistent list formatting
        text = """# Lists

- Item 1
-  Item 2
-   Item 3

* Bullet 1
*  Bullet 2

1. Numbered 1
2.  Numbered 2
"""

        result = format_markdown.invoke({"markdown_text": text})

        self.assertFalse(result.startswith("ERROR"))
        self.assertIsInstance(result, str)
        print("✓ List formatting works")

    def test_empty_input(self):
        """Test handling of empty input."""
        result = format_markdown.invoke({"markdown_text": ""})

        # Should handle empty input gracefully (empty or minimal output)
        self.assertFalse(result.startswith("ERROR"))
        print("✓ Empty input handled")

    def test_special_characters(self):
        """Test handling of special characters."""
        text = """# Title with émojis 🚀

Text with **bold** and *italic* and `code`.

> Blockquote with special chars: & < > "
"""

        result = format_markdown.invoke({"markdown_text": text})

        self.assertFalse(result.startswith("ERROR"))
        # Special characters should be preserved
        self.assertIn("🚀", result)
        print("✓ Special characters handled")

    def test_link_formatting(self):
        """Test link formatting preservation."""
        text = """# Links

[Link text](https://example.com)
[Another link](https://example.com/page)

<https://autolink.com>
"""

        result = format_markdown.invoke({"markdown_text": text})

        self.assertFalse(result.startswith("ERROR"))
        # Links should be preserved
        self.assertIn("[Link text]", result)
        self.assertIn("https://example.com", result)
        print("✓ Link formatting works")

    def test_returns_correct_structure(self):
        """Test that result is a string."""
        text = "# Test"
        result = format_markdown.invoke({"markdown_text": text})

        # Result should be a string
        self.assertIsInstance(result, str)
        self.assertIn("Test", result)
        print("✓ Result structure is correct")


class TestFormatMarkdownEdgeCases(unittest.TestCase):
    """Test edge cases and error conditions."""

    def test_very_long_text(self):
        """Test handling of very long text."""
        # Generate a long markdown document
        long_text = "# Header\n\n" + "\n\n".join([f"Paragraph {i}" for i in range(1000)])

        result = format_markdown.invoke({"markdown_text": long_text})

        self.assertFalse(result.startswith("ERROR"))
        print("✓ Long text handled")

    def test_nested_structures(self):
        """Test nested lists and blockquotes."""
        text = """# Nested

- Item 1
  - Subitem 1a
  - Subitem 1b
    - Sub-subitem
- Item 2

> Blockquote
> > Nested quote
> > > Deeply nested
"""

        result = format_markdown.invoke({"markdown_text": text})

        self.assertFalse(result.startswith("ERROR"))
        print("✓ Nested structures handled")

    def test_mixed_line_endings(self):
        """Test handling of mixed line endings."""
        text = "# Header\r\nSome text\nMore text\r\n"

        result = format_markdown.invoke({"markdown_text": text})

        self.assertFalse(result.startswith("ERROR"))
        print("✓ Mixed line endings handled")


if __name__ == '__main__':
    unittest.main()
