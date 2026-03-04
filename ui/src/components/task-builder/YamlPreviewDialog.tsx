"use client";

import React, { useCallback, useState } from "react";
import { X, Download, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface YamlPreviewDialogProps {
  yaml: string;
  filename: string;
  onClose: () => void;
  onDownload: () => void;
}

export function YamlPreviewDialog({
  yaml,
  filename,
  onClose,
  onDownload,
}: YamlPreviewDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [yaml]);

  const handleDownload = useCallback(() => {
    onDownload();
    onClose();
  }, [onDownload, onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[80vh] rounded-xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-foreground">
              {filename}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              YAML
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleDownload}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <pre className="p-5 text-sm font-mono leading-relaxed whitespace-pre text-foreground">
            <YamlHighlighted content={yaml} />
          </pre>
        </div>

        <div className="flex items-center justify-between px-5 py-2.5 border-t border-border bg-muted/20 text-xs text-muted-foreground">
          <span>{yaml.split("\n").length} lines</span>
          <span>{new Blob([yaml]).size.toLocaleString()} bytes</span>
        </div>
      </div>
    </div>
  );
}

function YamlHighlighted({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span className="select-none w-8 text-right pr-4 text-muted-foreground/40 shrink-0">
            {i + 1}
          </span>
          <span>
            <HighlightLine line={line} />
          </span>
        </div>
      ))}
    </>
  );
}

function HighlightLine({ line }: { line: string }) {
  if (line.trim().startsWith("#")) {
    return <span className="text-muted-foreground italic">{line}</span>;
  }

  const keyMatch = line.match(/^(\s*)(- )?([^:]+?)(:)(.*)/);
  if (keyMatch) {
    const [, indent, dash = "", key, colon, rest] = keyMatch;
    return (
      <>
        <span>{indent}</span>
        {dash && <span className="text-muted-foreground">{dash}</span>}
        <span className="text-cyan-400">{key}</span>
        <span className="text-muted-foreground">{colon}</span>
        <HighlightValue value={rest} />
      </>
    );
  }

  if (line.trim().startsWith("- ")) {
    const indent = line.match(/^(\s*)/)?.[1] || "";
    const rest = line.slice(indent.length + 2);
    return (
      <>
        <span>{indent}</span>
        <span className="text-muted-foreground">- </span>
        <HighlightValue value={rest} />
      </>
    );
  }

  return <span>{line}</span>;
}

function HighlightValue({ value }: { value: string }) {
  const trimmed = value.trim();

  if (!trimmed) return <span>{value}</span>;

  if (/^["']/.test(trimmed)) {
    return <span className="text-green-400">{value}</span>;
  }

  if (trimmed === "true" || trimmed === "false") {
    return <span className="text-amber-400">{value}</span>;
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return <span className="text-purple-400">{value}</span>;
  }

  if (trimmed === "null" || trimmed === "~") {
    return <span className="text-red-400/70">{value}</span>;
  }

  return <span className="text-green-400">{value}</span>;
}
