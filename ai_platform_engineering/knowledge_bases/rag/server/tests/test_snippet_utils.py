"""Tests for snippet_utils module."""

from server.snippet_utils import (
  extract_query_phrases,
  find_match_positions,
  extract_snippets_by_match_length,
  highlight_terms_in_snippet,
  format_search_result,
)


class TestExtractQueryPhrases:
  """Tests for extract_query_phrases function."""

  def test_single_word(self):
    """Single word returns just that word."""
    result = extract_query_phrases("kubernetes")
    assert result == ["kubernetes"]

  def test_two_words_generates_full_and_individuals(self):
    """Two words generates full phrase and individual words."""
    result = extract_query_phrases("deploy application")
    # Should have: "deploy application", "deploy", "application"
    assert "deploy application" in result
    assert "deploy" in result
    assert "application" in result
    # Longest first
    assert result[0] == "deploy application"

  def test_three_words_generates_ngrams(self):
    """Three words generates all n-grams."""
    result = extract_query_phrases("how to deploy")
    # Full: "how to deploy"
    # 2-grams: "how to", "to deploy"
    # Words: "how", "to", "deploy"
    assert "how to deploy" in result
    assert "how to" in result
    assert "to deploy" in result
    assert "deploy" in result
    # Longest first
    assert result[0] == "how to deploy"

  def test_sorts_by_length_descending(self):
    """Results are sorted by length, longest first."""
    result = extract_query_phrases("kubernetes deployment guide")
    lengths = [len(p) for p in result]
    assert lengths == sorted(lengths, reverse=True)

  def test_normalizes_whitespace(self):
    """Multiple spaces are collapsed."""
    result = extract_query_phrases("deploy   application")
    assert "deploy application" in result
    assert "deploy   application" not in result

  def test_handles_empty_query(self):
    """Empty query returns empty list."""
    assert extract_query_phrases("") == []
    assert extract_query_phrases("   ") == []

  def test_skips_single_char_words(self):
    """Single character words are excluded."""
    result = extract_query_phrases("a b test")
    assert "a" not in result
    assert "b" not in result
    assert "test" in result

  def test_preserves_all_words_including_stop_words(self):
    """Stop words are NOT filtered - we want phrase matching."""
    result = extract_query_phrases("how to deploy the app")
    assert "how" in result
    assert "to" in result
    assert "the" in result
    assert "how to deploy the app" in result


class TestFindMatchPositions:
  """Tests for find_match_positions function."""

  def test_finds_exact_match(self):
    """Finds exact phrase match."""
    text = "Learn how to deploy kubernetes applications"
    phrases = ["deploy kubernetes"]
    positions = find_match_positions(text, phrases)
    assert len(positions) == 1
    assert positions[0][2] == "deploy kubernetes"

  def test_case_insensitive(self):
    """Matching is case insensitive."""
    text = "KUBERNETES deployment guide"
    phrases = ["kubernetes"]
    positions = find_match_positions(text, phrases)
    assert len(positions) == 1

  def test_longer_phrases_matched_first(self):
    """When phrases overlap, longer ones take precedence."""
    text = "how to deploy kubernetes"
    # Phrases should be sorted by length desc before calling
    phrases = ["how to deploy", "how to", "deploy", "how"]
    positions = find_match_positions(text, phrases)

    # Should match "how to deploy" and "kubernetes" shouldn't double-match "deploy"
    matched_phrases = [p[2] for p in positions]
    assert "how to deploy" in matched_phrases
    # "deploy" alone shouldn't appear since it's covered by "how to deploy"
    assert "deploy" not in matched_phrases

  def test_non_overlapping_matches(self):
    """Multiple non-overlapping matches are found."""
    text = "deploy the app and deploy again"
    phrases = ["deploy"]
    positions = find_match_positions(text, phrases)
    assert len(positions) == 2

  def test_no_matches(self):
    """Returns empty list when no matches."""
    text = "some random text"
    phrases = ["kubernetes"]
    positions = find_match_positions(text, phrases)
    assert positions == []

  def test_returns_sorted_by_position(self):
    """Results are sorted by position in document."""
    text = "end kubernetes start middle argocd"
    phrases = ["kubernetes", "argocd"]
    positions = find_match_positions(text, phrases)
    starts = [p[0] for p in positions]
    assert starts == sorted(starts)


class TestExtractSnippetsByMatchLength:
  """Tests for extract_snippets_by_match_length function."""

  def test_extracts_single_snippet(self):
    """Extracts a snippet around a single match."""
    text = "x" * 100 + " kubernetes " + "y" * 100
    positions = [(100, 111, "kubernetes")]
    snippets = extract_snippets_by_match_length(text, positions, window_size=20)
    assert len(snippets) == 1
    assert "kubernetes" in snippets[0]

  def test_extracts_non_overlapping_snippets(self):
    """Extracts multiple non-overlapping snippets."""
    text = "start " + "a" * 200 + " middle " + "b" * 200 + " end"
    positions = [(0, 5, "start"), (208, 214, "middle"), (415, 418, "end")]
    snippets = extract_snippets_by_match_length(text, positions, max_snippets=3, max_total_chars=1000)
    assert len(snippets) <= 3

  def test_respects_max_snippets(self):
    """Doesn't exceed max_snippets limit."""
    text = "a b c d e f g h i j"
    positions = [(i * 2, i * 2 + 1, chr(97 + i)) for i in range(10)]
    snippets = extract_snippets_by_match_length(text, positions, max_snippets=2)
    assert len(snippets) <= 2

  def test_respects_max_total_chars(self):
    """Doesn't exceed max_total_chars limit."""
    text = "word " * 100
    positions = [(i * 5, i * 5 + 4, "word") for i in range(20)]
    snippets = extract_snippets_by_match_length(text, positions, max_total_chars=100)
    total_len = sum(len(s) for s in snippets)
    assert total_len <= 150  # Allow some buffer for window expansion

  def test_empty_positions(self):
    """Returns empty list for no positions."""
    snippets = extract_snippets_by_match_length("some text", [])
    assert snippets == []

  def test_prioritizes_longest_matches(self):
    """Longest matches are selected first."""
    # "graph rag" (9 chars) should be prioritized over "rag" (3 chars)
    text = "intro rag here and later graph rag is mentioned"
    positions = [
      (6, 9, "rag"),  # short match at start
      (26, 35, "graph rag"),  # long match in middle
    ]
    snippets = extract_snippets_by_match_length(text, positions, max_snippets=1, max_total_chars=100)
    assert len(snippets) == 1
    assert "graph rag" in snippets[0]


class TestHighlightTermsInSnippet:
  """Tests for highlight_terms_in_snippet function."""

  def test_highlights_single_term(self):
    """Single term is wrapped in bold."""
    result = highlight_terms_in_snippet("deploy the app", ["deploy"])
    assert result == "**deploy** the app"

  def test_preserves_original_case(self):
    """Original case is preserved in highlighted text."""
    result = highlight_terms_in_snippet("DEPLOY the App", ["deploy", "app"])
    assert "**DEPLOY**" in result
    assert "**App**" in result

  def test_highlights_phrase(self):
    """Multi-word phrase is highlighted as unit."""
    result = highlight_terms_in_snippet("how to deploy apps", ["how to deploy"])
    assert "**how to deploy**" in result

  def test_longer_phrases_highlighted_first(self):
    """Longer phrases take precedence over shorter terms."""
    # Phrases should be sorted by length desc
    phrases = ["deploy kubernetes", "deploy"]
    result = highlight_terms_in_snippet("deploy kubernetes cluster", phrases)
    # Should highlight "deploy kubernetes" as one unit, not "deploy" separately
    assert "**deploy kubernetes**" in result
    # "deploy" alone shouldn't be double-highlighted within the phrase
    assert result.count("**deploy") == 1

  def test_no_matches(self):
    """Text unchanged when no matches."""
    result = highlight_terms_in_snippet("some text", ["other"])
    assert result == "some text"


class TestFormatSearchResult:
  """Tests for format_search_result function."""

  def test_includes_title(self):
    """Title from metadata is included."""
    result = format_search_result("content", {"title": "My Title"}, "query")
    assert "**Title:** My Title" in result

  def test_includes_description(self):
    """Description from metadata is included."""
    result = format_search_result("content", {"description": "My description"}, "query")
    assert "**Description:** My description" in result

  def test_includes_source_from_nested_metadata(self):
    """Source from nested metadata is included."""
    result = format_search_result("content", {"metadata": {"source": "https://example.com"}}, "query")
    assert "**Source:** https://example.com" in result

  def test_includes_highlighted_snippet(self):
    """Snippet with highlighted terms is included."""
    result = format_search_result("This document explains kubernetes deployment strategies", {}, "kubernetes deployment")
    assert "**Snippet:**" in result
    assert "**kubernetes deployment**" in result or "**kubernetes**" in result

  def test_fallback_when_no_matches(self):
    """Falls back to truncated content when no query matches."""
    content = "This is some content without matches"
    result = format_search_result(content, {}, "xyz123nonexistent")
    assert "**Snippet:**" in result
    assert "This is some content" in result

  def test_handles_empty_metadata(self):
    """Works with empty metadata dict."""
    result = format_search_result("content here", {}, "content")
    assert "**Snippet:**" in result

  def test_omits_empty_fields(self):
    """Empty title/description/source are omitted."""
    result = format_search_result("content", {"title": ""}, "content")
    assert "**Title:**" not in result

  def test_full_formatted_output(self):
    """Full output includes all parts in correct order."""
    result = format_search_result("Guide to deploying kubernetes applications in production", {"title": "K8s Guide", "description": "A deployment guide", "metadata": {"source": "https://k8s.io/docs"}}, "kubernetes")
    assert "**Title:** K8s Guide" in result
    assert "**Description:** A deployment guide" in result
    assert "**Snippet:**" in result
    assert "**Source:** https://k8s.io/docs" in result
    # Title should come before Source
    assert result.index("Title") < result.index("Source")

  def test_phrase_matching_preferred(self):
    """Longer phrases are matched preferentially."""
    content = "Learn how to deploy kubernetes applications step by step"
    result = format_search_result(content, {}, "how to deploy")
    # Should highlight the full phrase
    assert "**how to deploy**" in result
