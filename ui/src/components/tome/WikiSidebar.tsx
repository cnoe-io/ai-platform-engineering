"use client";

import { useState } from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { KindBadge } from "@/components/tome/KindBadge";
import type { PageKind, PageTreeNode } from "@/types/tome";

interface Props {
  tree: PageTreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  showHidden: boolean;
  /** Delete a page (hover-trash on rows). Omitted in read-only contexts. */
  onDelete?: (path: string) => void;
}

/** Recursive sidebar nav for the wiki page tree. */
export function WikiSidebar({ tree, selectedPath, onSelect, showHidden, onDelete }: Props) {
  return (
    <nav className="text-sm">
      <NodeList
        nodes={tree}
        depth={0}
        selectedPath={selectedPath}
        onSelect={onSelect}
        showHidden={showHidden}
        onDelete={onDelete}
      />
    </nav>
  );
}

// Left padding per nesting level. The caret/spacer slot (CARET_W) is rendered
// on every row, so a child clears its parent's *label* (not just its caret).
const STEP_PX = 12;
const BASE_PX = 8;

// Collection-root folders that start collapsed, so the rail leads with the
// top-level synthesis pages rather than per-source subtrees or the glossary.
const COLLAPSED_ROOTS = new Set(["repos", "webex", "confluence", "glossary", "edges"]);

// Root source folders get their provider's brand mark instead of a bare label.
const ROOT_PROVIDER: Record<string, string> = {
  repos: "github",
  confluence: "atlassian",
  webex: "webex",
};

function NodeList({
  nodes,
  depth,
  selectedPath,
  onSelect,
  showHidden,
  onDelete,
}: {
  nodes: PageTreeNode[];
  depth: number;
} & Omit<Props, "tree">) {
  return (
    <ul>
      {nodes
        .filter((n) => showHidden || n.kind !== "hidden")
        .map((node) => (
          <li key={node.path}>
            <TreeNode
              node={node}
              depth={depth}
              selectedPath={selectedPath}
              onSelect={onSelect}
              showHidden={showHidden}
              onDelete={onDelete}
            />
          </li>
        ))}
    </ul>
  );
}

/** A single tree node: a collapsible folder header, or a selectable page row. */
function TreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  showHidden,
  onDelete,
}: {
  node: PageTreeNode;
  depth: number;
} & Omit<Props, "tree">) {
  const hasChildren = node.children.length > 0;
  const leaf = node.path.split("/").pop() ?? node.path;
  const [open, setOpen] = useState(!COLLAPSED_ROOTS.has(leaf));
  const indent = { paddingLeft: `${depth * STEP_PX + BASE_PX}px` };

  const children = hasChildren && (
    <NodeList
      nodes={node.children}
      depth={depth + 1}
      selectedPath={selectedPath}
      onSelect={onSelect}
      showHidden={showHidden}
      onDelete={onDelete}
    />
  );

  // Folder = a collapsible section header (the caret toggles its children).
  if (node.kind === "folder") {
    const provider = depth === 0 ? ROOT_PROVIDER[leaf] : undefined;
    return (
      <>
        <button
          type="button"
          style={indent}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 transition-transform",
              open && "rotate-90",
            )}
          />
          {provider && (
            <ProviderLogo provider={provider} className="h-3 w-3 shrink-0 object-contain" />
          )}
          <span className="truncate">{node.title}</span>
          {hasChildren && (
            <span className="ml-auto shrink-0 pl-2 text-[10px] font-normal tabular-nums text-muted-foreground/70">
              {node.children.length}
            </span>
          )}
        </button>
        {open && children}
      </>
    );
  }

  const selected = node.path === selectedPath;
  return (
    <>
      {/* `group` row: title button, then the (always-visible) kind badge, then
          the hover-trash. Badge + trash are siblings of the button (a button
          can't nest a button); the trash keeps its layout slot via opacity so
          the badge sits at a stable position whether or not it shows. */}
      <div
        className={cn(
          "group flex items-center gap-1.5 rounded pr-1.5 transition-colors hover:bg-muted",
          selected && "bg-muted font-medium text-primary",
        )}
      >
        <button
          type="button"
          style={indent}
          onClick={() => onSelect(node.path)}
          className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left"
        >
          {/* Empty caret slot keeps page labels aligned with folder labels at
              the same depth. */}
          <span className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{node.title}</span>
        </button>
        <span className="flex shrink-0 items-center">
          <KindBadge kind={node.kind as PageKind} iconOnly />
        </span>
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.path);
            }}
            className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            aria-label={`Delete ${node.title}`}
            title={`Delete ${node.title}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {children}
    </>
  );
}
