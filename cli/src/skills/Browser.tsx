/**
 * Ink paginated skills catalog browser.
 *
 * Arrow-key navigation, search bar, tag filter, preview pane on Enter,
 * `i` to install from within browser.
 */

import { Box, Text, useApp, useInput } from "ink";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Spinner } from "../platform/display.js";
import { renderMarkdown } from "../platform/markdown.js";
import type { CatalogEntry } from "./catalog.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrowserProps {
  onInstall?: (name: string) => Promise<void>;
  tagFilter?: string;
  showInstalled?: boolean;
  installedNames?: Set<string>;
}

// ---------------------------------------------------------------------------
// Browser component
// ---------------------------------------------------------------------------

export function SkillsBrowser({
  onInstall,
  tagFilter,
  showInstalled = false,
  installedNames = new Set(),
}: BrowserProps): React.ReactElement {
  const { exit } = useApp();
  const [skills, setSkills] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Load catalog
  useEffect(() => {
    const load = async () => {
      try {
        const { fetchCatalog } = await import("./catalog.js");
        const catalog = await fetchCatalog();
        let list = catalog.skills;
        if (tagFilter) {
          list = list.filter((s) => s.tags.includes(tagFilter));
        }
        if (showInstalled) {
          list = list.filter((s) => installedNames.has(s.name));
        }
        setSkills(list);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [tagFilter, showInstalled, installedNames]);

  // Filtered list based on search
  const filtered = skills.filter(
    (s) =>
      searchTerm === "" ||
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.description.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const selectedSkill = filtered[cursor];

  const fetchPreview = useCallback(async (skill: CatalogEntry) => {
    setPreviewLoading(true);
    try {
      const res = await fetch(skill.url);
      if (res.ok) {
        setPreviewContent(await res.text());
      } else {
        setPreviewContent(`Could not load preview (HTTP ${res.status})`);
      }
    } catch (err) {
      setPreviewContent(`Preview unavailable: ${String(err)}`);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useInput((char, key) => {
    if (previewMode) {
      // Any key exits preview
      setPreviewMode(false);
      setPreviewContent(null);
      return;
    }

    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        setSearchTerm("");
        return;
      }
      if (key.return) {
        setSearchMode(false);
        setCursor(0);
        return;
      }
      if (key.backspace || key.delete) {
        setSearchTerm((prev) => prev.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && char) {
        setSearchTerm((prev) => prev + char);
      }
      return;
    }

    // Navigation
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
      return;
    }

    // Enter → preview
    if (key.return && selectedSkill) {
      setPreviewMode(true);
      void fetchPreview(selectedSkill);
      return;
    }

    // i → install
    if (char === "i" && selectedSkill && onInstall) {
      setStatusMsg(`Installing "${selectedSkill.name}"…`);
      onInstall(selectedSkill.name)
        .then(() => {
          setStatusMsg(`Installed "${selectedSkill.name}"`);
          setTimeout(() => setStatusMsg(null), 2000);
        })
        .catch((err: unknown) => {
          setStatusMsg(`Error: ${String(err)}`);
          setTimeout(() => setStatusMsg(null), 3000);
        });
      return;
    }

    // / → search
    if (char === "/") {
      setSearchMode(true);
      return;
    }

    // q or Escape → exit
    if (char === "q" || key.escape) {
      exit();
      return;
    }
  });

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) return <Spinner label="Loading skills catalog…" />;
  if (error !== null) {
    return (
      <Box>
        <Text color="red">[ERROR] {error}</Text>
      </Box>
    );
  }

  if (previewMode && selectedSkill) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text bold>Preview: {selectedSkill.name}</Text>
          <Text dimColor> Press any key to return</Text>
        </Box>
        <Box padding={1}>
          {previewLoading ? (
            <Spinner label="Loading preview…" />
          ) : (
            <Text>{previewContent !== null ? renderMarkdown(previewContent) : ""}</Text>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">
          Skills Catalog
        </Text>
        <Text dimColor>↑↓ navigate Enter preview i install / search q quit</Text>
      </Box>

      {/* Search bar */}
      {searchMode && (
        <Box paddingX={1}>
          <Text color="yellow">Search: {searchTerm}█</Text>
        </Box>
      )}

      {/* Skill list */}
      <Box flexDirection="column" paddingX={1}>
        {filtered.length === 0 && (
          <Text dimColor>No skills found{searchTerm ? ` matching "${searchTerm}"` : ""}.</Text>
        )}
        {filtered.map((skill, i) => {
          const isSelected = i === cursor;
          const isInstalled = installedNames.has(skill.name);
          return (
            <Box key={skill.name}>
              <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                {isSelected ? "▶ " : "  "}
              </Text>
              <Text color={isSelected ? "white" : undefined}>{skill.name}</Text>
              <Text color="gray"> v{skill.version}</Text>
              {isInstalled && <Text color="green"> ✓</Text>}
              <Text dimColor> — {skill.description}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Status message */}
      {statusMsg !== null && (
        <Box paddingX={1}>
          <Text color="green">{statusMsg}</Text>
        </Box>
      )}

      <Box paddingX={1}>
        <Text dimColor>
          {filtered.length} skill{filtered.length !== 1 ? "s" : ""}
        </Text>
      </Box>
    </Box>
  );
}
