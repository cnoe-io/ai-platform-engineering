/**
 * MessageAttachments — renders files a user attached to a turn, inside the
 * transcript (not just the composer). Images show as a thumbnail from their
 * base64 data URL; other files show as a document chip with name + size.
 *
 * Unlike AttachmentChips (which previews pending browser `File`s via object
 * URLs), this renders persisted `MessageAttachment`s carried on the message and
 * restored from the DB, so the upload stays visible across reloads. When an
 * attachment's `data` was dropped (too large to persist inline), it falls back
 * to a document chip so the name/size are still shown.
 */

import { formatBytes } from "@/lib/file-attachments";
import { cn } from "@/lib/utils";
import type { MessageAttachment } from "@/types/a2a";
import { FileText } from "lucide-react";

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
  /** Align the row; user turns are right-aligned to match the bubble. */
  align?: "start" | "end";
}

function isImage(att: MessageAttachment): boolean {
  return att.mime_type.startsWith("image/") && !!att.data;
}

function ImageAttachment({ att }: { att: MessageAttachment }) {
  const src = `data:${att.mime_type};base64,${att.data}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={att.name}
      title={att.name}
      className="max-h-64 max-w-full rounded-lg border border-border object-contain"
    />
  );
}

function FileAttachment({ att }: { att: MessageAttachment }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card py-1.5 pl-1.5 pr-3 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <FileText className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="max-w-[12rem] truncate text-xs font-medium text-foreground">
          {att.name}
        </span>
        {att.size != null && (
          <span className="text-[11px] text-muted-foreground">{formatBytes(att.size)}</span>
        )}
      </div>
    </div>
  );
}

export function MessageAttachments({ attachments, align = "end" }: MessageAttachmentsProps) {
  if (attachments.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap gap-2",
        align === "end" ? "justify-end" : "justify-start",
      )}
    >
      {attachments.map((att, idx) => (
        <div key={`${att.name}-${idx}`} className="max-w-full">
          {isImage(att) ? <ImageAttachment att={att} /> : <FileAttachment att={att} />}
        </div>
      ))}
    </div>
  );
}
