"""
Snippet extraction utilities for RAG search results.

Provides intelligent text extraction around query matches with term highlighting.
Zero external dependencies - uses only Python stdlib.

Matching strategy:
1. Try to match the full query first
2. Then try progressively smaller n-grams (phrases)
3. Finally try individual words
4. Always prefer longest matches
"""

import re

DEFAULT_SNIPPET_LENGTH = 400
DEFAULT_CONTEXT_WINDOW = 120
MAX_SNIPPETS = 3


def extract_query_phrases(query: str) -> list[str]:
  """
  Generate candidate phrases from query, ordered by length (longest first).

  Strategy:
  1. Full query (normalized)
  2. Contiguous n-grams from n-1 down to 2 words
  3. Individual words (only those > 1 char)

  Args:
      query: The search query string

  Returns:
      List of phrases/terms, sorted by length descending (longest first)
  """
  # Normalize: collapse whitespace, strip
  normalized = " ".join(query.split())
  if not normalized:
    return []

  words = normalized.split()
  if not words:
    return []

  phrases = set()

  # Add full query if multi-word
  if len(words) > 1:
    phrases.add(normalized)

  # Generate n-grams from largest to smallest (n-1 down to 2)
  for n in range(len(words) - 1, 1, -1):
    for i in range(len(words) - n + 1):
      phrase = " ".join(words[i : i + n])
      phrases.add(phrase)

  # Add individual words (skip single chars)
  for word in words:
    if len(word) > 1:
      phrases.add(word)

  # Sort by length descending (longest matches first)
  return sorted(phrases, key=len, reverse=True)


def find_match_positions(text: str, phrases: list[str]) -> list[tuple[int, int, str]]:
  """
  Find all positions of phrases/terms in text, avoiding overlapping matches.

  Matches longer phrases first so shorter terms don't duplicate coverage.

  Args:
      text: The document text to search
      phrases: List of phrases/terms to find (should be sorted by length desc)

  Returns:
      List of (start, end, matched_phrase) tuples, sorted by position
  """
  positions = []
  covered = set()  # Track character positions already matched

  for phrase in phrases:
    # Simple case-insensitive search
    pattern = re.compile(re.escape(phrase), re.IGNORECASE)

    for match in pattern.finditer(text):
      start, end = match.start(), match.end()

      # Skip if this range overlaps with already-matched positions
      match_range = set(range(start, end))
      if match_range & covered:
        continue

      positions.append((start, end, phrase))
      covered.update(match_range)

  return sorted(positions, key=lambda x: x[0])


def extract_snippets_by_match_length(
  text: str,
  positions: list[tuple[int, int, str]],
  max_snippets: int = MAX_SNIPPETS,
  window_size: int = DEFAULT_CONTEXT_WINDOW,
  max_total_chars: int = DEFAULT_SNIPPET_LENGTH,
) -> list[str]:
  """
  Extract snippets prioritizing longest/best matches first.

  Strategy: sort by match length descending, pick non-overlapping snippets.

  Args:
      text: The full document text
      positions: List of (start, end, phrase) match positions
      max_snippets: Maximum number of snippets to extract
      window_size: Characters before/after match to include
      max_total_chars: Maximum total characters across all snippets

  Returns:
      List of snippet strings, sorted by document position
  """
  if not positions:
    return []

  # Build snippet windows with match length for sorting
  windows = []
  for start, end, phrase in positions:
    match_len = end - start
    win_start = max(0, start - window_size)
    win_end = min(len(text), end + window_size)

    # Expand to word boundaries
    space_before = text.rfind(" ", max(0, win_start - 30), win_start)
    if space_before != -1:
      win_start = space_before + 1
    space_after = text.find(" ", win_end, min(len(text), win_end + 30))
    if space_after != -1:
      win_end = space_after

    windows.append((win_start, win_end, phrase, match_len))

  # Sort by match length descending (longest matches first)
  windows.sort(key=lambda x: x[3], reverse=True)

  selected = []
  used_ranges = []
  chars_used = 0

  for win_start, win_end, phrase, match_len in windows:
    if len(selected) >= max_snippets:
      break

    snippet_len = win_end - win_start

    # Check overlap with existing selections
    overlaps = any(not (win_end <= r[0] or win_start >= r[1]) for r in used_ranges)

    if not overlaps and chars_used + snippet_len <= max_total_chars:
      snippet = text[win_start:win_end].strip()
      selected.append((win_start, snippet))
      used_ranges.append((win_start, win_end))
      chars_used += snippet_len

  # Sort by document position for readable output
  selected.sort(key=lambda x: x[0])
  return [s[1] for s in selected]


def highlight_terms_in_snippet(snippet: str, phrases: list[str]) -> str:
  """
  Wrap phrase/term matches with **bold** markers, preserving original case.

  Processes longest phrases first to avoid double-highlighting.

  Args:
      snippet: The text snippet to highlight
      phrases: List of phrases/terms to highlight (should be sorted by length desc)

  Returns:
      Snippet with matched terms wrapped in **bold**
  """
  # Collect all matches with their positions, prioritizing longer phrases
  matches_to_highlight = []  # List of (start, end) tuples
  covered = set()

  for phrase in phrases:
    pattern = re.compile(re.escape(phrase), re.IGNORECASE)

    for match in pattern.finditer(snippet):
      start, end = match.start(), match.end()
      match_range = set(range(start, end))

      # Skip if any part of this range is already covered by a longer match
      if match_range & covered:
        continue

      matches_to_highlight.append((start, end))
      covered.update(match_range)

  # Sort by position descending so we can insert ** markers without shifting earlier positions
  matches_to_highlight.sort(key=lambda x: x[0], reverse=True)

  # Apply highlighting from end to start
  result = snippet
  for start, end in matches_to_highlight:
    result = result[:start] + "**" + result[start:end] + "**" + result[end:]

  return result


def format_search_result(
  page_content: str,
  metadata: dict,
  query: str,
  max_total_length: int = DEFAULT_SNIPPET_LENGTH,
) -> str:
  """
  Format a search result with metadata + highlighted snippets (longest matches first).

  Output format:
      **Title:** {title}

      **Description:** {description}

      **Snippet:** ...text with **highlighted** terms...
      [...]
      ...more **highlighted** content...

      **Source:** {url}

  Args:
      page_content: The full document content
      metadata: Document metadata dict (may have nested 'metadata' key)
      query: The original search query
      max_total_length: Maximum total length for the formatted output

  Returns:
      Formatted string with metadata and highlighted snippets
  """
  parts = []

  # Extract metadata (handle nested structure)
  nested_meta = metadata.get("metadata", {}) if isinstance(metadata.get("metadata"), dict) else {}
  title = metadata.get("title") or nested_meta.get("title") or ""
  description = metadata.get("description") or nested_meta.get("description") or ""
  source = nested_meta.get("source") or metadata.get("source") or ""

  if title:
    parts.append(f"**Title:** {title}")
  if description:
    parts.append(f"**Description:** {description}")

  # Calculate remaining space for snippet
  header_len = sum(len(p) for p in parts) + len(parts) * 2  # 2 for newlines
  source_len = len(f"**Source:** {source}") + 2 if source else 0
  available_for_snippet = max_total_length - header_len - source_len - 20  # buffer

  # Extract phrases and find matches
  phrases = extract_query_phrases(query)

  if phrases and available_for_snippet > 50:
    positions = find_match_positions(page_content, phrases)

    if positions:
      snippets = extract_snippets_by_match_length(
        page_content,
        positions,
        max_snippets=MAX_SNIPPETS,
        max_total_chars=available_for_snippet,
      )

      if snippets:
        highlighted = [highlight_terms_in_snippet(s, phrases) for s in snippets]
        snippet_text = "\n[...]\n".join(f"...{s}..." for s in highlighted)
        parts.append(f"**Snippet:** {snippet_text}")

  # Fallback: no phrases or no matches
  if not any(p.startswith("**Snippet:**") for p in parts):
    fallback_len = min(available_for_snippet, 300)
    if fallback_len > 0:
      fallback = page_content[:fallback_len].strip()
      if len(page_content) > fallback_len:
        fallback += "..."
      parts.append(f"**Snippet:** {fallback}")

  if source:
    parts.append(f"**Source:** {source}")

  return "\n\n".join(parts)
