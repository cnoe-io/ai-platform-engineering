"use client";

import React, { useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Folder, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileTreeProps {
  /** List of file paths from the agent's in-memory filesystem */
  files: string[];
  /** Callback when a file is clicked (for download) */
  onFileClick?: (path: string) => void;
  /** Whether a download is in progress */
  isDownloading?: boolean;
  /** Currently downloading file path */
  downloadingPath?: string;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
}

/**
 * FileTree component displays files from the agent's in-memory filesystem.
 * Files are shown in a tree structure with folders expanded.
 * Clicking a file triggers a download.
 */
export function FileTree({
  files,
  onFileClick,
  isDownloading = false,
  downloadingPath,
}: FileTreeProps) {
  // Build tree structure from flat file paths
  const tree = useMemo(() => buildTree(files), [files]);

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-foreground">
        <FileText className="h-4 w-4 text-blue-400 shrink-0" />
        <span className="font-medium whitespace-nowrap">Files</span>
        <span className="text-muted-foreground">({files.length})</span>
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/30 p-2">
        <AnimatePresence mode="popLayout">
          {tree.map((node, idx) => (
            <TreeNodeItem
              key={node.path}
              node={node}
              depth={0}
              index={idx}
              onFileClick={onFileClick}
              isDownloading={isDownloading}
              downloadingPath={downloadingPath}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  index: number;
  onFileClick?: (path: string) => void;
  isDownloading?: boolean;
  downloadingPath?: string;
}

function TreeNodeItem({
  node,
  depth,
  index,
  onFileClick,
  isDownloading,
  downloadingPath,
}: TreeNodeItemProps) {
  const isCurrentlyDownloading = isDownloading && downloadingPath === node.path;

  const handleClick = useCallback(() => {
    if (!node.isDirectory && onFileClick) {
      onFileClick(node.path);
    }
  }, [node.isDirectory, node.path, onFileClick]);

  return (
    <motion.div
      initial={{ opacity: 0, x: -5 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.02 }}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 py-1 px-1 rounded text-xs",
          !node.isDirectory && "hover:bg-muted cursor-pointer group",
          !node.isDirectory && isCurrentlyDownloading && "bg-blue-500/10"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={handleClick}
        role={node.isDirectory ? undefined : "button"}
        tabIndex={node.isDirectory ? undefined : 0}
        onKeyDown={(e) => {
          if (!node.isDirectory && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        {node.isDirectory ? (
          <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        ) : isCurrentlyDownloading ? (
          <Loader2 className="h-3.5 w-3.5 text-blue-400 shrink-0 animate-spin" />
        ) : (
          <FileText className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        )}
        <span
          className={cn(
            "truncate flex-1",
            node.isDirectory
              ? "font-medium text-foreground/80"
              : "text-foreground/70 group-hover:text-foreground"
          )}
          title={node.path}
        >
          {node.name}
        </span>
        {!node.isDirectory && !isCurrentlyDownloading && (
          <Download className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        )}
      </div>

      {/* Render children for directories */}
      {node.isDirectory && node.children.length > 0 && (
        <div>
          {node.children.map((child, idx) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              index={idx}
              onFileClick={onFileClick}
              isDownloading={isDownloading}
              downloadingPath={downloadingPath}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

/**
 * Internal node type with childMap for efficient tree construction
 */
interface TreeNodeWithMap extends TreeNode {
  childMap: Map<string, TreeNodeWithMap>;
}

/**
 * Build a tree structure from flat file paths.
 * 
 * Input: ["/src/index.ts", "/src/utils/helper.ts", "/README.md"]
 * Output: Tree with src/ folder containing index.ts and utils/helper.ts
 * 
 * Note: The `path` field preserves the original path (with leading /) for API calls.
 */
function buildTree(paths: string[]): TreeNode[] {
  const rootMap = new Map<string, TreeNodeWithMap>();

  for (const originalPath of paths) {
    const parts = originalPath.split("/").filter(Boolean);
    let currentMap = rootMap;
    // Track whether original path had leading slash
    const hasLeadingSlash = originalPath.startsWith("/");

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      // Build path preserving leading slash if original had it
      const builtPath = hasLeadingSlash
        ? "/" + parts.slice(0, i + 1).join("/")
        : parts.slice(0, i + 1).join("/");
      const isLastPart = i === parts.length - 1;

      if (!currentMap.has(part)) {
        const node: TreeNodeWithMap = {
          name: part,
          path: builtPath,
          isDirectory: !isLastPart,
          children: [],
          childMap: new Map(),
        };
        currentMap.set(part, node);
      }

      const node = currentMap.get(part)!;

      // Ensure intermediate nodes are directories
      if (!isLastPart) {
        node.isDirectory = true;
        currentMap = node.childMap;
      }
    }
  }

  // Convert maps to children arrays recursively
  function mapToChildren(map: Map<string, TreeNodeWithMap>): TreeNode[] {
    return sortNodes(
      Array.from(map.values()).map((node) => ({
        name: node.name,
        path: node.path,
        isDirectory: node.isDirectory,
        children: mapToChildren(node.childMap),
      }))
    );
  }

  return mapToChildren(rootMap);
}

/**
 * Sort nodes: directories first, then files, both alphabetically
 */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      children: sortNodes(node.children),
    }))
    .sort((a, b) => {
      // Directories before files
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      // Alphabetical within same type
      return a.name.localeCompare(b.name);
    });
}
