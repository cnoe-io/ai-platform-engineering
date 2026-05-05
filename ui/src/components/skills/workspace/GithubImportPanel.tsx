"use client";

/**
 * @deprecated Prefer `RepoImportPanel` directly.
 *
 * Kept as a one-line re-export shim so existing imports
 * (`import { GithubImportPanel } from ".../GithubImportPanel"`) keep
 * working without churn while the source toggle / multi-path UX moves
 * into `RepoImportPanel` (FR-019).
 */

export {
  RepoImportPanel as GithubImportPanel,
  type RepoImportPanelProps as GithubImportPanelProps,
} from "./RepoImportPanel";
