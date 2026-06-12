"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { KindBadge } from "@/components/tome/KindBadge";
import type { PageKind, PageTreeNode } from "@/types/tome";

interface Props {
  tree: PageTreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  showHidden: boolean;
}

/** Recursive sidebar nav for the wiki page tree. */
export function WikiSidebar({ tree, selectedPath, onSelect, showHidden }: Props) {
  return (
    <nav className="text-sm">
      <NodeList
        nodes={tree}
        depth={0}
        selectedPath={selectedPath}
        onSelect={onSelect}
        showHidden={showHidden}
      />
    </nav>
  );
}

function NodeList({
  nodes,
  depth,
  selectedPath,
  onSelect,
  showHidden,
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
            <NodeRow
              node={node}
              depth={depth}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
            {node.children.length > 0 && (
              <NodeList
                nodes={node.children}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                showHidden={showHidden}
              />
            )}
          </li>
        ))}
    </ul>
  );
}

function NodeRow({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: PageTreeNode;
  depth: number;
} & Pick<Props, "selectedPath" | "onSelect">) {
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  // Folder nodes are non-clickable headers.
  if (node.kind === "folder") {
    return (
      <div
        style={indent}
        className="flex items-center gap-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        <ChevronRight className="h-3 w-3" />
        {node.title}
      </div>
    );
  }

  const selected = node.path === selectedPath;
  return (
    <button
      type="button"
      style={indent}
      onClick={() => onSelect(node.path)}
      className={cn(
        "flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left transition-colors hover:bg-muted",
        selected && "bg-muted font-medium text-primary",
      )}
    >
      <span className="truncate">{node.title}</span>
      <span className="ml-auto shrink-0">
        <KindBadge kind={node.kind as PageKind} iconOnly />
      </span>
    </button>
  );
}
