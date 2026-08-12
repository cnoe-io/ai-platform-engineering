import mammoth from "mammoth";
import { NodeHtmlMarkdown } from "node-html-markdown";

import {
  MAX_IMPORT_FILE_BYTES,
  TOME_IMPORT_EXTENSIONS,
} from "@/lib/tome/document-import-formats";
import { serializeFrontmatter } from "@/lib/tome/schema";

export interface ConvertedDocumentImport {
  path: string;
  markdown: string;
  warnings: string[];
}

function extensionOf(path: string): string {
  const match = path.toLowerCase().match(/\.[^.\/]+$/);
  return match?.[0] ?? "";
}

function humanTitle(path: string): string {
  const leaf = path.split("/").pop() ?? path;
  const stem = leaf.replace(/\.[^.]+$/, "");
  const value = stem.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return value ? value.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Imported document";
}

/** Convert a selected document path to the safe `.md` path Tome stores. */
export function importedPagePath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.endsWith("/") ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Invalid import path: ${JSON.stringify(sourcePath)}`);
  }
  const extension = extensionOf(normalized);
  if (!(TOME_IMPORT_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new Error(`Unsupported import format: ${extension || "no extension"}`);
  }
  return extension === ".md" ? normalized : `${normalized.slice(0, -extension.length)}.md`;
}

function htmlToMarkdown(html: string): string {
  return NodeHtmlMarkdown.translate(html, {
    bulletMarker: "-",
    codeBlockStyle: "fenced",
    ignore: ["script", "style", "noscript", "svg", "iframe", "object", "embed"],
    keepDataImages: false,
  }).trim();
}

function wrapConvertedBody(path: string, body: string): string {
  return serializeFrontmatter(
    { title: humanTitle(path), kind: "stable" },
    body.trim() || "_(no text could be extracted from this document)_",
  );
}

/**
 * Convert one user-supplied document to a Tome markdown page.
 *
 * Markdown remains verbatim. Other formats receive stable-page frontmatter so
 * a future ingest cannot silently overwrite the imported source document.
 */
export async function convertDocumentImport(input: {
  sourcePath: string;
  data: Buffer;
}): Promise<ConvertedDocumentImport> {
  if (input.data.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new Error(`Import file exceeds ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB`);
  }
  const extension = extensionOf(input.sourcePath);
  const path = importedPagePath(input.sourcePath);

  switch (extension) {
    case ".md":
    case ".mdx":
      return { path, markdown: input.data.toString("utf8"), warnings: [] };
    case ".txt":
      return {
        path,
        markdown: wrapConvertedBody(path, input.data.toString("utf8")),
        warnings: [],
      };
    case ".html":
    case ".htm":
      return {
        path,
        markdown: wrapConvertedBody(path, htmlToMarkdown(input.data.toString("utf8"))),
        warnings: [],
      };
    case ".docx": {
      const result = await mammoth.convertToHtml(
        { buffer: input.data },
        { externalFileAccess: false, includeEmbeddedStyleMap: false },
      );
      return {
        path,
        markdown: wrapConvertedBody(path, htmlToMarkdown(result.value)),
        warnings: result.messages.map((message) => message.message),
      };
    }
    case ".pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(input.data));
      const result = await extractText(pdf, { mergePages: true });
      const text = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
      return {
        path,
        markdown: wrapConvertedBody(path, text),
        warnings: [],
      };
    }
    default:
      throw new Error(`Unsupported import format: ${extension || "no extension"}`);
  }
}
