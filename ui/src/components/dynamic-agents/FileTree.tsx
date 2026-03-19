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
 * Internal node type with childMap for efficient tree construction.
 * For leaf nodes, `fullPath` stores the original path for API calls.
 */
interface TreeNodeWithMap {
  name: string;
  fullPath: string | null; // Original path for leaves, null for directories
  children: Map<string, TreeNodeWithMap>;
}

/**
 * Build a tree structure from flat file paths.
 *
 * Input: ["/src/index.ts", "/src/utils/helper.ts", "/README.md"]
 * Output: Tree with src/ folder containing index.ts and utils/helper.ts
 *
 * Leaf nodes store the original path directly - no reconstruction needed.
 */
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNodeWithMap = { name: "", fullPath: null, children: new Map() };

  for (const originalPath of paths) {
    const parts = originalPath.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath: isLeaf ? originalPath : null,
          children: new Map(),
        });
      } else if (isLeaf) {
        // Update existing node to be a leaf with the full path
        current.children.get(part)!.fullPath = originalPath;
      }

      current = current.children.get(part)!;
    }
  }

  // Convert to TreeNode[], recursively
  function toTreeNodes(node: TreeNodeWithMap): TreeNode[] {
    return sortNodes(
      Array.from(node.children.values()).map((child) => ({
        name: child.name,
        path: child.fullPath ?? child.name, // fullPath for leaves, name for dirs (path unused for dirs)
        isDirectory: child.fullPath === null,
        children: toTreeNodes(child),
      }))
    );
  }

  return toTreeNodes(root);
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
