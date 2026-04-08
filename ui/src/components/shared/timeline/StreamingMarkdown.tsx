"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { assistantMarkdownComponents, assistantProseClassName } from "@/components/chat/MarkdownComponents";

interface StreamingMarkdownProps {
  content: string;
  isStreaming?: boolean;
  /**
   * "thinking" = muted, compact style (for intermediate content)
   * "final" = full prose style with code highlighting (for final answers)
   */
  variant?: "thinking" | "final";
  className?: string;
}

/**
 * Simplified markdown components for "thinking" content.
 * Avoids prose styling that can create unwanted borders/boxes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const thinkingMarkdownComponents: Record<string, React.ComponentType<any>> = {
  p: ({ children }) => <p className="text-sm leading-relaxed text-muted-foreground/80 mb-1.5 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground/80">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => <code className="bg-muted/50 text-foreground/70 px-1 py-0.5 rounded text-[12px] font-mono">{children}</code>,
  a: ({ children, href }) => <a className="text-primary/80 underline underline-offset-2" href={href}>{children}</a>,
  ul: ({ children }) => <ul className="list-disc list-outside ml-6 mb-1.5 space-y-0.5 text-sm text-muted-foreground/80">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-outside ml-6 mb-1.5 space-y-0.5 text-sm text-muted-foreground/80">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  // Render code blocks as simple pre without fancy styling
  pre: ({ children }) => <pre className="bg-muted/30 rounded px-2 py-1.5 text-xs overflow-x-auto my-1.5">{children}</pre>,
};

/**
 * Renders markdown content with configurable styling.
 * Used for both thinking segments and final answers in agent timelines.
 */
export function StreamingMarkdown({
  content,
  variant = "final",
  className,
}: StreamingMarkdownProps) {
  if (!content) return null;

  // Use simple styling for thinking variant to avoid prose-related issues
  if (variant === "thinking") {
    return (
      <div className={cn("max-w-none", className)}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={thinkingMarkdownComponents}>
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className={cn(assistantProseClassName, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
