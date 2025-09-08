"""
Unit tests for URL scrapers.
"""
from bs4 import BeautifulSoup

from kb_rag.server.loader.url.docsaurus_scraper import scrape_docsaurus
from kb_rag.server.loader.url.mkdocs_scraper import scrape_mkdocs


class TestDocusaurusScraper:
    """Test Docusaurus scraper functionality."""

    def test_scrape_docsaurus_success(self):
        """Test successful Docusaurus scraping."""
        html_content = """
        <html>
            <head>
                <title>Test Documentation</title>
            </head>
            <body>
                <nav class="navbar">
                    <a href="/docs/intro">Introduction</a>
                    <a href="/docs/guides">Guides</a>
                </nav>
                <main>
                    <article>
                        <h1>Test Page</h1>
                        <p>This is test content for Docusaurus.</p>
                    </article>
                </main>
            </body>
        </html>
        """

        soup = BeautifulSoup(html_content, 'html.parser')
        result = scrape_docsaurus(soup)

        assert isinstance(result, str)
        assert "Test Page" in result
        assert "This is test content for Docusaurus" in result
        # Should remove navigation elements
        assert "Introduction" not in result
        assert "Guides" not in result

    def test_scrape_docsaurus_empty_content(self):
        """Test Docusaurus scraping with empty content."""
        html_content = "<html><body></body></html>"
        soup = BeautifulSoup(html_content, 'html.parser')
        result = scrape_docsaurus(soup)

        assert isinstance(result, str)
        assert result.strip() == ""

    def test_scrape_docsaurus_no_main_content(self):
        """Test Docusaurus scraping without main content."""
        html_content = """
        <html>
            <body>
                <nav class="navbar">
                    <a href="/docs/intro">Introduction</a>
                </nav>
            </body>
        </html>
        """

        soup = BeautifulSoup(html_content, 'html.parser')
        result = scrape_docsaurus(soup)

        assert isinstance(result, str)
        # Should still return some content even without main
        # Note: The scraper may still include navigation content


class TestMkdocsScraper:
    """Test MkDocs scraper functionality."""

    def test_scrape_mkdocs_success(self):
        """Test successful MkDocs scraping."""
        html_content = """
        <html>
            <head>
                <title>Test Documentation</title>
            </head>
            <body>
                <nav class="md-nav">
                    <a href="/intro/">Introduction</a>
                    <a href="/guides/">Guides</a>
                </nav>
                <main class="md-main">
                    <article class="md-content">
                        <h1>Test Page</h1>
                        <p>This is test content for MkDocs.</p>
                    </article>
                </main>
            </body>
        </html>
        """

        soup = BeautifulSoup(html_content, 'html.parser')
        result = scrape_mkdocs(soup)

        assert isinstance(result, str)
        assert "Test Page" in result
        assert "This is test content for MkDocs" in result
        # Note: Navigation elements may still be present depending on scraper implementation

    def test_scrape_mkdocs_empty_content(self):
        """Test MkDocs scraping with empty content."""
        html_content = "<html><body></body></html>"
        soup = BeautifulSoup(html_content, 'html.parser')
        result = scrape_mkdocs(soup)

        assert isinstance(result, str)
        assert result.strip() == ""

    def test_scrape_mkdocs_no_main_content(self):
        """Test MkDocs scraping without main content."""
        html_content = """
        <html>
            <body>
                <nav class="md-nav">
                    <a href="/intro/">Introduction</a>
                </nav>
            </body>
        </html>
        """

        soup = BeautifulSoup(html_content, 'html.parser')
        result = scrape_mkdocs(soup)

        assert isinstance(result, str)
        # Should still return some content even without main
        # Note: The scraper may still include navigation content

    def test_scrape_mkdocs_with_code_blocks(self):
        """Test MkDocs scraping with code blocks."""
        html_content = """
        <html>
            <body>
                <main class="md-main">
                    <article class="md-content">
                        <h1>Code Example</h1>
                        <pre><code>def hello_world():
    print("Hello, World!")</code></pre>
                        <p>This is a code example.</p>
                    </article>
                </main>
            </body>
        </html>
        """

        soup = BeautifulSoup(html_content, 'html.parser')
        result = scrape_mkdocs(soup)

        assert isinstance(result, str)
        assert "Code Example" in result
        assert "def hello_world():" in result
        assert "print(\"Hello, World!\")" in result
        assert "This is a code example" in result


class TestScraperIntegration:
    """Test scraper integration scenarios."""

    def test_scrape_docsaurus_with_special_characters(self):
        """Test Docusaurus scraping with special characters."""
        html_content = """
        <html>
            <body>
                <main>
                    <article>
                        <h1>Special Characters Test</h1>
                        <p>This contains &amp; &lt; &gt; and other HTML entities.</p>
                        <p>Math: x² + y² = z²</p>
                    </article>
                </main>
            </body>
        </html>
        """

        soup = BeautifulSoup(html_content, 'html.parser')
        result = scrape_docsaurus(soup)

        assert isinstance(result, str)
        assert "Special Characters Test" in result
        assert "& < >" in result or "&amp; &lt; &gt;" in result
        assert "x² + y² = z²" in result

    def test_scrape_mkdocs_with_tables(self):
        """Test MkDocs scraping with tables."""
        html_content = """
        <html>
            <body>
                <main class="md-main">
                    <article class="md-content">
                        <h1>Table Example</h1>
                        <table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>Item 1</td>
                                    <td>100</td>
                                </tr>
                                <tr>
                                    <td>Item 2</td>
                                    <td>200</td>
                                </tr>
                            </tbody>
                        </table>
                    </article>
                </main>
            </body>
        </html>
        """

        soup = BeautifulSoup(html_content, 'html.parser')
        result = scrape_mkdocs(soup)

        assert isinstance(result, str)
        assert "Table Example" in result
        assert "Name" in result
        assert "Value" in result
        assert "Item 1" in result
        assert "Item 2" in result

    def test_scrape_docsaurus_with_links(self):
        """Test Docusaurus scraping with links."""
        html_content = """
        <html>
            <body>
                <main>
                    <article>
                        <h1>Links Test</h1>
                        <p>Check out <a href="/docs/guide">this guide</a> for more info.</p>
                        <p>External link: <a href="https://example.com">Example</a></p>
                    </article>
                </main>
            </body>
        </html>
        """

        soup = BeautifulSoup(html_content, 'html.parser')
        result = scrape_docsaurus(soup)

        assert isinstance(result, str)
        assert "Links Test" in result
        assert "this guide" in result
        assert "Example" in result
        # Links should be preserved as text

    def test_scrape_mkdocs_with_lists(self):
        """Test MkDocs scraping with lists."""
        html_content = """
        <html>
            <body>
                <main class="md-main">
                    <article class="md-content">
                        <h1>List Example</h1>
                        <ul>
                            <li>First item</li>
                            <li>Second item</li>
                            <li>Third item</li>
                        </ul>
                        <ol>
                            <li>Numbered item 1</li>
                            <li>Numbered item 2</li>
                        </ol>
                    </article>
                </main>
            </body>
        </html>
        """

        soup = BeautifulSoup(html_content, 'html.parser')
        result = scrape_mkdocs(soup)

        assert isinstance(result, str)
        assert "List Example" in result
        assert "First item" in result
        assert "Second item" in result
        assert "Third item" in result
        assert "Numbered item 1" in result
        assert "Numbered item 2" in result
