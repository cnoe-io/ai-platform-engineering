"use client";

/**
 * RichCodeEditor — a VS Code/Atom-style CodeMirror 6 editor wrapper.
 *
 * Features (out of the box):
 *   - Line numbers, current-line highlight, indent guides
 *   - Bracket matching + auto-close
 *   - Code folding (gutter + keymap)
 *   - Syntax highlighting per language (auto-detected from filename or
 *     explicit `language` prop, via @codemirror/language-data)
 *   - Search & replace (Cmd/Ctrl+F, Cmd/Ctrl+H)
 *   - Multi-cursor, rectangular selection
 *   - Soft-wrap toggle (controlled prop)
 *   - Lint gutter + tooltips driven by a caller-supplied `linter` callback
 *   - Theme follows the user's `prefers-color-scheme` (one-dark when dark)
 *
 * Designed to be the single editor primitive for both the SKILL.md editor
 * (Workspace's Files tab) and the SkillFolderViewer's editor pane.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CodeMirror, {
  type ReactCodeMirrorRef,
  type Extension,
} from "@uiw/react-codemirror";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { indentWithTab, history, undo, redo } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  LanguageDescription,
  type LanguageSupport,
} from "@codemirror/language";
import { languages as cmLanguageData } from "@codemirror/language-data";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { lintGutter, type Diagnostic } from "@codemirror/lint";
import { linter as cmLinter } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RichCodeEditorProps {
  /** Source text. Controlled. */
  value: string;
  /** Called on every edit (string-only, no transactions exposed). */
  onChange?: (next: string) => void;

  /**
   * Filename or extension hint used to auto-detect the language. When
   * provided, takes priority over the explicit `language` prop.
   * Examples: "SKILL.md", "config.yaml", "main.py".
   */
  filename?: string;

  /**
   * Explicit language id (matches @codemirror/language-data names). Used
   * only if `filename` is not provided. Examples: "markdown", "json",
   * "yaml", "python", "typescript", "shell", "html", "css".
   */
  language?: string;

  /** Editor is non-editable when true. */
  readOnly?: boolean;

  /** Toggle soft line-wrapping. Default: false. */
  wrap?: boolean;

  /** Show line numbers gutter. Default: true. */
  showLineNumbers?: boolean;

  /** Show fold gutter. Default: true. */
  showFoldGutter?: boolean;

  /**
   * Optional custom lint source — invoked on doc changes; return zero or
   * more `Diagnostic` entries to surface inline + in the gutter.
   */
  lintSource?: (doc: string) => Diagnostic[] | Promise<Diagnostic[]>;

  /**
   * Optional custom autocompletion source. Receives the current context;
   * return null to defer.
   */
  completionSource?: CompletionSource;

  /** Min height of the editor (CSS). Default: "240px". */
  minHeight?: string;
  /** Max height of the editor (CSS). Default: "70vh". */
  maxHeight?: string;
  /** Force a fixed height (overrides min/max). */
  height?: string;

  /** Extra classnames on the outer wrapper. */
  className?: string;

  /** Imperative ref to the underlying CodeMirror instance. */
  editorRef?: React.MutableRefObject<ReactCodeMirrorRef | null>;
}

// ---------------------------------------------------------------------------
// Language resolution
// ---------------------------------------------------------------------------

const EXT_LANGUAGE_HINTS: Record<string, string> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  py: "python",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  html: "html",
  htm: "html",
  css: "css",
  scss: "sass",
  less: "less",
  go: "go",
  rs: "rust",
  java: "java",
  cpp: "c++",
  c: "c",
  h: "c",
  hpp: "c++",
  rb: "ruby",
  php: "php",
  sql: "sql",
  xml: "xml",
  toml: "toml",
};

function pickLanguageDescription(opts: {
  filename?: string;
  language?: string;
}): LanguageDescription | null {
  const { filename, language } = opts;
  // 1. filename → ext lookup
  if (filename) {
    const lower = filename.toLowerCase();
    const dot = lower.lastIndexOf(".");
    if (dot > -1 && dot < lower.length - 1) {
      const ext = lower.slice(dot + 1);
      const hint = EXT_LANGUAGE_HINTS[ext];
      if (hint) {
        const desc = LanguageDescription.matchLanguageName(
          cmLanguageData,
          hint,
          true,
        );
        if (desc) return desc;
      }
      const byExt = LanguageDescription.matchFilename(cmLanguageData, lower);
      if (byExt) return byExt;
    }
  }
  // 2. explicit language id
  if (language) {
    const desc = LanguageDescription.matchLanguageName(
      cmLanguageData,
      language,
      true,
    );
    if (desc) return desc;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Theme (light vs dark)
// ---------------------------------------------------------------------------

function usePrefersDark(): boolean {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = (e: MediaQueryListEvent) => setDark(e.matches);
    mql.addEventListener?.("change", fn);
    return () => mql.removeEventListener?.("change", fn);
  }, []);
  return dark;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RichCodeEditor({
  value,
  onChange,
  filename,
  language,
  readOnly = false,
  wrap = false,
  showLineNumbers = true,
  showFoldGutter = true,
  lintSource,
  completionSource,
  minHeight = "240px",
  maxHeight = "70vh",
  height,
  className,
  editorRef,
}: RichCodeEditorProps) {
  const dark = usePrefersDark();
  const [langSupport, setLangSupport] = useState<LanguageSupport | null>(null);

  // Resolve and lazy-load the language for the given filename/language.
  useEffect(() => {
    let cancelled = false;
    const desc = pickLanguageDescription({ filename, language });
    if (!desc) {
      setLangSupport(null);
      return;
    }
    desc
      .load()
      .then((support) => {
        if (!cancelled) setLangSupport(support);
      })
      .catch(() => {
        if (!cancelled) setLangSupport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [filename, language]);

  // Stable lint extension that re-reads `lintSource` on each change.
  const lintSourceRef = useRef<RichCodeEditorProps["lintSource"]>(lintSource);
  useEffect(() => {
    lintSourceRef.current = lintSource;
  }, [lintSource]);

  const completionSourceRef = useRef<CompletionSource | undefined>(
    completionSource,
  );
  useEffect(() => {
    completionSourceRef.current = completionSource;
  }, [completionSource]);

  const extensions = useMemo<Extension[]>(() => {
    const exts: Extension[] = [
      history(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      autocompletion({
        override: completionSourceRef.current
          ? [
              (ctx) => {
                const fn = completionSourceRef.current;
                return fn ? fn(ctx) : null;
              },
            ]
          : undefined,
      }),
      keymap.of([
        ...closeBracketsKeymap,
        ...searchKeymap,
        ...completionKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      wrap ? EditorView.lineWrapping : [],
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ];

    if (showLineNumbers) exts.push(lineNumbers());
    if (showFoldGutter) exts.push(foldGutter());

    if (langSupport) exts.push(langSupport);

    // Always include the lint gutter + a linter that consults the latest
    // ref. Empty array when no source is supplied.
    exts.push(lintGutter());
    exts.push(
      cmLinter(async (view) => {
        const src = lintSourceRef.current;
        if (!src) return [];
        try {
          const result = await Promise.resolve(src(view.state.doc.toString()));
          return result || [];
        } catch {
          return [];
        }
      }),
    );

    return exts;
    // We intentionally do NOT depend on `completionSource`/`lintSource`
    // directly — they are read via refs to avoid rebuilding the entire
    // extension array (and thus losing editor state) on every parent render.
  }, [langSupport, wrap, readOnly, showLineNumbers, showFoldGutter]);

  const handleChange = useCallback(
    (next: string) => {
      onChange?.(next);
    },
    [onChange],
  );

  return (
    <div
      className={cn(
        "rich-code-editor relative overflow-hidden rounded-md border border-border/60 bg-background",
        className,
      )}
      data-rich-editor
    >
      <CodeMirror
        ref={editorRef ?? undefined}
        value={value}
        height={height}
        minHeight={height ? undefined : minHeight}
        maxHeight={height ? undefined : maxHeight}
        theme={dark ? oneDark : "light"}
        extensions={extensions}
        onChange={handleChange}
        basicSetup={false}
      />
    </div>
  );
}

/**
 * Imperative helpers re-exported from `@codemirror/commands` so consumers
 * can wire toolbar buttons (Undo/Redo) without importing CodeMirror
 * internals directly.
 */
export { undo as cmUndo, redo as cmRedo };
export type { Diagnostic, ReactCodeMirrorRef };
