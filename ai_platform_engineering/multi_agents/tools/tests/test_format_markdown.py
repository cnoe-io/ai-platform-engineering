# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for the format_markdown tool.

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

        self.assertTrue(result['success'])
        self.assertIn('formatted_text', result)
        self.assertIsNotNone(result['formatted_text'])
        self.assertIn('fixed_issues', result)
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

        self.assertIn('validation', result)
        self.assertIn('valid', result['validation'])
        # Should report as valid or with minimal issues
        print("✓ Validation mode works")

    def test_validate_only_with_issues(self):
        """Test validation detects formatting issues."""
        # Poorly formatted markdown
        bad_md = """#Header
Some text
-item
-  item"""

        result = format_markdown.invoke({"markdown_text": bad_md, "validate_only": True})

        self.assertIn('validation', result)
        self.assertFalse(result['validation']['valid'])
        self.assertGreater(result['validation']['issue_count'], 0)
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

        self.assertTrue(result['success'])
        self.assertIn('formatted_text', result)
        # Table should be properly aligned
        formatted = result['formatted_text']
        self.assertIn('|', formatted)
        print("✓ Table formatting works")

    def test_heading_hierarchy(self):
        """Test proper heading formatting."""
        # Mixed heading styles
        text = """#Heading 1
##Heading 2
###  Heading 3

Some text."""

        result = format_markdown.invoke({"markdown_text": text})

        self.assertTrue(result['success'])
        formatted = result['formatted_text']
        # Headings should have proper spacing
        self.assertIn('# ', formatted)
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

        self.assertTrue(result['success'])
        formatted = result['formatted_text']
        # Code block should be preserved
        self.assertIn('```', formatted)
        self.assertIn('def hello', formatted)
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

        self.assertTrue(result['success'])
        self.assertIn('formatted_text', result)
        print("✓ List formatting works")

    def test_empty_input(self):
        """Test handling of empty input."""
        result = format_markdown.invoke({"markdown_text": ""})

        # Should handle empty input gracefully
        self.assertTrue(result['success'])
        print("✓ Empty input handled")

    def test_special_characters(self):
        """Test handling of special characters."""
        text = """# Title with émojis 🚀

Text with **bold** and *italic* and `code`.

> Blockquote with special chars: & < > "
"""

        result = format_markdown.invoke({"markdown_text": text})

        self.assertTrue(result['success'])
        formatted = result['formatted_text']
        # Special characters should be preserved
        self.assertIn('🚀', formatted)
        print("✓ Special characters handled")

    def test_link_formatting(self):
        """Test link formatting preservation."""
        text = """# Links

[Link text](https://example.com)
[Another link](https://example.com/page)

<https://autolink.com>
"""

        result = format_markdown.invoke({"markdown_text": text})

        self.assertTrue(result['success'])
        formatted = result['formatted_text']
        # Links should be preserved
        self.assertIn('[Link text]', formatted)
        self.assertIn('https://example.com', formatted)
        print("✓ Link formatting works")

    def test_returns_correct_structure(self):
        """Test that result has correct structure."""
        text = "# Test"
        result = format_markdown.invoke({"markdown_text": text})

        # Check required keys
        self.assertIn('formatted_text', result)
        self.assertIn('fixed_issues', result)
        self.assertIn('message', result)
        print("✓ Result structure is correct")


class TestFormatMarkdownEdgeCases(unittest.TestCase):
    """Test edge cases and error conditions."""

    def test_very_long_text(self):
        """Test handling of very long text."""
        # Generate a long markdown document
        long_text = "# Header\n\n" + "\n\n".join([f"Paragraph {i}" for i in range(1000)])

        result = format_markdown.invoke({"markdown_text": long_text})

        self.assertTrue(result['success'])
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

        self.assertTrue(result['success'])
        print("✓ Nested structures handled")

    def test_mixed_line_endings(self):
        """Test handling of mixed line endings."""
        text = "# Header\r\nSome text\nMore text\r\n"

        result = format_markdown.invoke({"markdown_text": text})

        self.assertTrue(result['success'])
        print("✓ Mixed line endings handled")


if __name__ == '__main__':
    unittest.main()





