"use client";

import { MarkdownRenderer } from "@/components/shared/timeline/MarkdownRenderer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { isPreviewableEphemeralFile } from "@/lib/ephemeral-files";
import { Download,Loader2,Maximize2,X } from "lucide-react";
import { useState } from "react";

interface EphemeralFilePreviewProps {
  path: string;
  content: string | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onDownload?: (path: string) => void;
  className?: string;
}

function FilePreviewBody({
  path,
  content,
  isLoading,
  error,
  expanded = false,
}: {
  path: string;
  content: string | null;
  isLoading: boolean;
  error: string | null;
  expanded?: boolean;
}) {
  const isMarkdown = isPreviewableEphemeralFile(path) && path.toLowerCase().endsWith(".md");

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading preview…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-500 py-2">{error}</p>;
  }

  if (content === null) {
    return null;
  }

  if (isMarkdown) {
    return (
      <div
        className={cn(
          "prose dark:prose-invert max-w-none",
          expanded ? "prose-base" : "prose-sm text-sm",
        )}
      >
        <MarkdownRenderer content={content} />
      </div>
    );
  }

  return (
    <pre
      className={cn(
        "font-mono whitespace-pre-wrap break-words text-foreground/90 leading-relaxed",
        expanded ? "text-sm" : "text-xs",
      )}
    >
      {content}
    </pre>
  );
}

export function EphemeralFilePreview({
  path,
  content,
  isLoading,
  error,
  onClose,
  onDownload,
  className,
}: EphemeralFilePreviewProps) {
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const filename = path.split("/").pop() || path;

  return (
    <>
      <div
        className={cn(
          "flex flex-col rounded-lg border border-border/60 bg-background/80 overflow-hidden min-h-[16rem]",
          className,
        )}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/40 shrink-0">
          <span className="text-xs font-medium truncate flex-1" title={path}>
            {filename}
          </span>
          <button
            type="button"
            onClick={() => setFullscreenOpen(true)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Open fullscreen preview"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          {onDownload && (
            <button
              type="button"
              onClick={() => onDownload(path)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Download file"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Close preview"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
          <FilePreviewBody
            path={path}
            content={content}
            isLoading={isLoading}
            error={error}
          />
        </div>
      </div>

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="flex h-[92vh] max-h-[92vh] min-w-0 w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border/50 px-5 py-4 pr-12">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate">{filename}</DialogTitle>
                <DialogDescription className="truncate font-mono text-xs mt-1">
                  {path}
                </DialogDescription>
              </div>
              {onDownload && (
                <button
                  type="button"
                  onClick={() => onDownload(path)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                  title="Download file"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
            <FilePreviewBody
              path={path}
              content={content}
              isLoading={isLoading}
              error={error}
              expanded
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
