/** Browser/server shared document-import limits and file-picker hints. */
export const TOME_IMPORT_ACCEPT =
  ".md,.mdx,.txt,.html,.htm,.docx,.pdf,text/markdown,text/plain,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf";

export const TOME_IMPORT_EXTENSIONS = [
  ".md",
  ".mdx",
  ".txt",
  ".html",
  ".htm",
  ".docx",
  ".pdf",
] as const;

export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_FILES = 20;
export const MAX_IMPORT_TOTAL_BYTES = 50 * 1024 * 1024;

export function isSupportedTomeImportPath(path: string): boolean {
  const lower = path.toLowerCase();
  return TOME_IMPORT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
