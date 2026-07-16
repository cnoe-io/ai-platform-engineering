/**
 * AttachmentChips — the pending-attachment row shown above the composer input.
 *
 * Renders each staged file as a chip: a real thumbnail for images (object URL)
 * or a document icon, with the truncated name, size, and a remove (×) button.
 * Object URLs are created lazily per image and revoked when the chip unmounts,
 * so previews never leak. Styling mirrors the composer (rounded-xl, bg-card,
 * border-border) and animates in/out with framer-motion.
 */

import { formatBytes } from "@/lib/file-attachments";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, X } from "lucide-react";
import { useEffect, useMemo } from "react";

/** One staged attachment: the browser File plus a stable id for keying/removal. */
export interface PendingAttachment {
  id: string;
  file: File;
}

interface AttachmentChipsProps {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  /** Disable removal while a turn is in flight. */
  disabled?: boolean;
}

/** An image thumbnail backed by an object URL that is revoked on unmount. */
function ImageThumb({ file }: { file: File }) {
  // Create the object URL during render (deterministic for a given File) and
  // revoke it on unmount — avoids a setState-in-effect cascade.
  const url = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={file.name}
      className="h-9 w-9 shrink-0 rounded-md object-cover"
    />
  );
}

function AttachmentChip({
  attachment,
  onRemove,
  disabled,
}: {
  attachment: PendingAttachment;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const { file } = attachment;
  const isImage = file.type.startsWith("image/");

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 4 }}
      transition={{ duration: 0.15 }}
      className="flex items-center gap-2 rounded-xl border border-border bg-card py-1.5 pl-1.5 pr-2 shadow-sm"
    >
      {isImage ? (
        <ImageThumb file={file} />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <FileText className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <span className="max-w-[10rem] truncate text-xs font-medium text-foreground">
          {file.name}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {formatBytes(file.size)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        disabled={disabled}
        aria-label={`Remove ${file.name}`}
        title="Remove attachment"
        className={cn(
          "ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          "text-muted-foreground transition-colors",
          "hover:bg-muted hover:text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

export function AttachmentChips({ attachments, onRemove, disabled }: AttachmentChipsProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      <AnimatePresence initial={false}>
        {attachments.map((attachment) => (
          <AttachmentChip
            key={attachment.id}
            attachment={attachment}
            onRemove={onRemove}
            disabled={disabled}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
