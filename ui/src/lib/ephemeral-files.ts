/** Extensions that can be previewed inline instead of forcing a download. */
export const PREVIEWABLE_FILE_EXTENSIONS = [".md", ".txt"] as const;

export function isPreviewableEphemeralFile(path: string): boolean {
  const lower = path.toLowerCase();
  return PREVIEWABLE_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function fetchEphemeralFileContent(
  fsNamespace: string,
  path: string,
): Promise<string | null> {
  const response = await fetch(
    `/api/files/content?fs_namespace=${encodeURIComponent(fsNamespace)}&path=${encodeURIComponent(path)}`,
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { content?: unknown };
  return typeof data.content === "string" ? data.content : "";
}
