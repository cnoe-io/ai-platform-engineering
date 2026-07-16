/**
 * File-attachment helpers for multimodal chat input.
 *
 * Pure, framework-free utilities shared by the composer: the MIME allowlist,
 * size caps, browser base64 encoding, and validation. The allowlist and caps
 * MUST mirror the backend (`_SUPPORTED_IMAGE_MIME_TYPES` +
 * `_SUPPORTED_DOC_MIME_TYPES` in the dynamic-agents runtime, and the Slack
 * ingress caps) so the UI rejects the same files the model would silently drop.
 */

/** The multimodal payload shape the backend expects per file. */
export interface InputFile {
  mime_type: string;
  data: string; // base64, no data: URI prefix
  name: string;
}

/** Image MIME types Bedrock's Converse API can ingest as image blocks. */
export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

/** Document MIME types the backend maps to document blocks. */
export const ACCEPTED_DOC_MIME_TYPES = [
  "application/pdf",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/html",
  "text/plain",
  "text/markdown",
] as const;

/** Every MIME type the composer will accept before upload. */
export const ACCEPTED_MIME_TYPES: readonly string[] = [
  ...ACCEPTED_IMAGE_MIME_TYPES,
  ...ACCEPTED_DOC_MIME_TYPES,
];

/** Comma-separated `accept` attribute for the hidden file input. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_MIME_TYPES.join(",");

/** Per-file cap (20 MiB) — mirrors the Slack ingress guard. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Cumulative cap across all attachments in one turn (40 MiB). */
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

export function isAcceptedMimeType(mimeType: string): boolean {
  return ACCEPTED_MIME_TYPES.includes(mimeType);
}

/** Human-readable byte size, e.g. "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

/**
 * Read a File in the browser and produce the backend's InputFile shape.
 *
 * Uses FileReader's data URL and strips the `data:<mime>;base64,` prefix, which
 * is the most widely-supported path to base64 in browsers/jsdom.
 */
export function fileToInputFile(file: File): Promise<InputFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Failed to read file: ${file.name}`));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error(`Unexpected read result for file: ${file.name}`));
        return;
      }
      // result is `data:<mime>;base64,<payload>` — keep only the payload.
      const comma = result.indexOf(",");
      const data = comma >= 0 ? result.slice(comma + 1) : result;
      resolve({
        // Fall back to the browser-reported type; some docs (e.g. .md) may be "".
        mime_type: file.type || "application/octet-stream",
        data,
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
  });
}

export interface RejectedFile {
  name: string;
  reason: string;
}

export interface ValidationResult {
  accepted: File[];
  rejected: RejectedFile[];
}

/**
 * Split incoming files into those that may be attached and those rejected,
 * enforcing MIME allowlist, per-file cap, and the cumulative cap across files
 * already staged plus everything accepted so far in this batch.
 *
 * @param existing Files already staged in the composer (count toward the total cap).
 * @param incoming New files the user is trying to add.
 */
export function validateFiles(existing: File[], incoming: File[]): ValidationResult {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];

  let runningTotal = existing.reduce((sum, f) => sum + f.size, 0);

  for (const file of incoming) {
    if (!isAcceptedMimeType(file.type)) {
      rejected.push({
        name: file.name,
        reason: `Unsupported file type${file.type ? ` (${file.type})` : ""}`,
      });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      rejected.push({
        name: file.name,
        reason: `Exceeds ${formatBytes(MAX_FILE_BYTES)} per-file limit`,
      });
      continue;
    }
    if (runningTotal + file.size > MAX_TOTAL_BYTES) {
      rejected.push({
        name: file.name,
        reason: `Would exceed ${formatBytes(MAX_TOTAL_BYTES)} total attachment limit`,
      });
      continue;
    }
    runningTotal += file.size;
    accepted.push(file);
  }

  return { accepted, rejected };
}
