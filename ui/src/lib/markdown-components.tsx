import React from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";

/**
 * Custom markdown components for consistent styling across the app
 * Used in Chat Panel, Workflow Execution, and Workflow History
 */
export const getMarkdownComponents = () => ({
  // Headings
  h1: ({ children }: any) => (
    <h1 className="text-xl font-bold text-foreground mb-3 mt-4 first:mt-0 pb-2 border-b border-border/50">
      {children}
    </h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="text-lg font-semibold text-foreground mb-2 mt-4 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="text-base font-semibold text-foreground mb-2 mt-3 first:mt-0">
      {children}
    </h3>
  ),
  // Paragraphs
  p: ({ children }: any) => (
    <p className="text-sm leading-relaxed text-foreground/90 mb-2 last:mb-0">
      {children}
    </p>
  ),
  // Lists
  ul: ({ children }: any) => (
    <ul className="list-disc list-outside ml-5 mb-2 space-y-1 text-sm text-foreground/90">
      {children}
    </ul>
  ),
  ol: ({ children }: any) => (
    <ol className="list-decimal list-outside ml-5 mb-2 space-y-1 text-sm text-foreground/90">
      {children}
    </ol>
  ),
  li: ({ children }: any) => (
    <li className="leading-relaxed">{children}</li>
  ),
  // Code
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    const codeContent = String(children).replace(/\n$/, "");
    const hasNewlines = codeContent.includes("\n");
    const isCodeBlock = match || hasNewlines || className;

    if (!isCodeBlock) {
      // Inline code
      return (
        <code
          className="bg-muted/80 text-primary px-1.5 py-0.5 rounded text-[13px] font-mono"
          {...props}
        >
          {children}
        </code>
      );
    }

    // Fenced code block
    const language = match ? match[1] : "";
    const shouldHighlight = match && language !== "text";

    return (
      <div className="my-4 rounded-lg overflow-hidden border border-border/30 bg-[#1e1e2e]">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/20 bg-[#181825]">
          <span className="text-xs text-zinc-500 font-mono uppercase tracking-wide">
            {language || "plain text"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-zinc-500 hover:text-zinc-300 hover:bg-transparent"
            onClick={() => {
              navigator.clipboard.writeText(codeContent);
            }}
            title="Copy code"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        {shouldHighlight ? (
          <SyntaxHighlighter
            style={oneDark}
            language={language}
            PreTag="div"
            customStyle={{
              margin: 0,
              borderRadius: 0,
              padding: "1rem 1.25rem",
              fontSize: "13px",
              lineHeight: "1.6",
              background: "transparent"
            }}
          >
            {codeContent}
          </SyntaxHighlighter>
        ) : (
          <pre className="p-4 overflow-x-auto">
            <code className="text-[13px] leading-relaxed text-zinc-300 font-mono whitespace-pre-wrap">
              {codeContent}
            </code>
          </pre>
        )}
      </div>
    );
  },
  // Blockquotes
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-4 border-primary/50 pl-4 my-3 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  // Tables
  table: ({ children }: any) => (
    <div className="overflow-x-auto my-3 rounded-lg border border-border/50 w-full">
      <table className="w-full text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: any) => (
    <thead className="bg-muted/50">{children}</thead>
  ),
  th: ({ children }: any) => (
    <th className="px-3 py-2 text-left font-semibold text-foreground border-b border-border/50 break-words">
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td className="px-3 py-2 border-b border-border/30 text-foreground/90 break-words align-top">
      {children}
    </td>
  ),
  tr: ({ children }: any) => (
    <tr className="hover:bg-muted/30 transition-colors">{children}</tr>
  ),
  // Links
  a: ({ href, children }: any) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/50 hover:decoration-primary transition-colors"
    >
      {children}
    </a>
  ),
  // Horizontal rule
  hr: () => (
    <hr className="my-6 border-border/50" />
  ),
  // Strong/Bold
  strong: ({ children }: any) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  // Emphasis/Italic
  em: ({ children }: any) => (
    <em className="italic text-foreground/90">{children}</em>
  ),
});
