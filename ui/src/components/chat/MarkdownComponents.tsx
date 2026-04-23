"use client";

import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";

// ─── Code Block with Copy Button ─────────────────────────────────────────────

function CodeBlockCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="h-6 w-6 flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-transparent transition-colors"
      title="Copy code"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

// ─── Shared Markdown Components ──────────────────────────────────────────────
//
// Used by both FinalAnswerSegment (AgentTimeline) and the assistant markdown
// card (ChatPanel) so that assistant output renders identically everywhere.

export const assistantMarkdownComponents: Record<string, React.ComponentType<any>> = {
  h1: ({ children }: { children: React.ReactNode }) => (
    <h1 className="text-xl font-bold text-foreground mb-3 mt-4 first:mt-0 pb-2 border-b border-border/50">{children}</h1>
  ),
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 className="text-lg font-semibold text-foreground mb-2 mt-4 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-base font-semibold text-foreground mb-2 mt-3 first:mt-0">{children}</h3>
  ),
  p: ({ children }: { children: React.ReactNode }) => (
    <p className="text-sm leading-relaxed text-foreground/90 mb-2 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children: React.ReactNode }) => (
    <ul className="list-disc list-outside ml-6 mb-2 space-y-1 text-sm text-foreground/90">{children}</ul>
  ),
  ol: ({ children }: { children: React.ReactNode }) => (
    <ol className="list-decimal list-outside ml-6 mb-2 space-y-1 text-sm text-foreground/90">{children}</ol>
  ),
  li: ({ children }: { children: React.ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }: { children: React.ReactNode }) => (
    <em className="italic text-foreground/90">{children}</em>
  ),
  blockquote: ({ children }: { children: React.ReactNode }) => (
    <blockquote className="border-l-4 border-primary/50 pl-4 my-3 italic text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-6 border-border/50" />,
  a: ({ href, children }: { href?: string; children: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/50 hover:decoration-primary transition-colors"
    >
      {children}
    </a>
  ),
  table: ({ children }: { children: React.ReactNode }) => (
    <div className="overflow-x-auto my-3 rounded-lg border border-border/50 w-full">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children: React.ReactNode }) => (
    <thead className="bg-muted/50">{children}</thead>
  ),
  th: ({ children }: { children: React.ReactNode }) => (
    <th className="px-3 py-2 text-left font-semibold text-foreground border-b border-border/50 break-words">{children}</th>
  ),
  td: ({ children }: { children: React.ReactNode }) => (
    <td className="px-3 py-2 border-b border-border/30 text-foreground/90 break-words align-top">{children}</td>
  ),
  tr: ({ children }: { children: React.ReactNode }) => (
    <tr className="hover:bg-muted/30 transition-colors">{children}</tr>
  ),
   
  code({ className, children, node, ...props }: { className?: string; children: React.ReactNode; node?: unknown; [key: string]: unknown }) {
    const match = /language-(\w+)/.exec(className || "");
    const codeContent = String(children).replace(/\n$/, "");
    const hasNewlines = codeContent.includes("\n");
    const isCodeBlock = match || hasNewlines || className;

    if (!isCodeBlock) {
      return (
        <code
          className={cn("bg-muted/80 text-primary px-1.5 py-0.5 rounded text-[13px] font-mono break-all", className)}
          {...props}
        >
          {children}
        </code>
      );
    }

    const language = match ? match[1] : "";
    const shellLanguages = ["bash", "sh", "shell", "zsh", "fish", "console", "terminal"];
    const isShell = shellLanguages.includes(language.toLowerCase());
    const shouldHighlight = match && language !== "text" && !isShell;

    return (
      <div className="my-4 rounded-lg overflow-hidden border border-border/30 bg-[#1e1e2e] max-w-full">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/20 bg-[#181825]">
          <span className="text-xs text-zinc-500 font-mono uppercase tracking-wide">
            {language || "plain text"}
          </span>
          <CodeBlockCopyButton code={codeContent} />
        </div>
        {shouldHighlight ? (
          <SyntaxHighlighter
            style={oneDark}
            language={language}
            PreTag="div"
            wrapLongLines
            customStyle={{
              margin: 0,
              borderRadius: 0,
              padding: "1rem 1.25rem",
              fontSize: "13px",
              lineHeight: "1.6",
              background: "transparent",
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
            }}
          >
            {codeContent}
          </SyntaxHighlighter>
        ) : (
          <pre className="p-4 overflow-x-auto max-w-full">
            <code className="text-[13px] leading-relaxed font-mono whitespace-pre-wrap break-words">
              {codeContent.split("\n").map((line, i) => {
                const trimmed = line.trimStart();
                const isComment = trimmed.startsWith("#") || trimmed.startsWith("//");
                return (
                  <span key={i}>
                    {isComment ? (
                      <span className="text-zinc-500 italic">{line}</span>
                    ) : (
                      <span className="text-zinc-300">{line}</span>
                    )}
                    {i < codeContent.split("\n").length - 1 ? "\n" : ""}
                  </span>
                );
              })}
            </code>
          </pre>
        )}
      </div>
    );
  },
};

/** Prose wrapper className for assistant markdown content.
 *  NOTE: We intentionally omit `prose prose-sm dark:prose-invert` because
 *  every element has an explicit component override in assistantMarkdownComponents.
 *  Adding prose classes causes double-styling (e.g. double borders on code blocks)
 *  since globals.css defines `.prose pre`, `.prose code`, etc.
 */
export const assistantProseClassName =
  "max-w-none text-foreground";
