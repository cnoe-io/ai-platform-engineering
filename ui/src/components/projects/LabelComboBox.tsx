"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Datalist-backed free-text combobox for project label dimensions
 * (BHAG / Initiative, Swim Lane). Shared by the onboarding wizard and the
 * project Settings pane so both surfaces have identical UX: type a new value or
 * pick an existing one; `multi` keeps a comma-separated list in the input.
 *
 * Value is the raw input string (comma/newline-separated when `multi`). Callers
 * split it into a string[] at submit time.
 */
export function applyComboSelection(
  current: string,
  selected: string,
  multi: boolean,
): string {
  if (!multi) return selected;
  const lastDelim = Math.max(current.lastIndexOf(","), current.lastIndexOf("\n"));
  const head = lastDelim >= 0 ? current.slice(0, lastDelim + 1) : "";
  return `${head ? head.trimEnd() + " " : ""}${selected}, `;
}

export function LabelComboBox({
  value,
  onChange,
  options,
  placeholder,
  multi = false,
  onType,
  ariaLabel,
  inputClassName = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  multi?: boolean;
  onType?: (v: string) => void;
  ariaLabel?: string;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  }, [open]);

  const lastToken = (multi ? (value.split(/[\n,]/).pop() ?? "") : value).trim().toLowerCase();
  const filtered = options
    .filter(
      (o) =>
        !lastToken ||
        o.label.toLowerCase().includes(lastToken) ||
        o.value.toLowerCase().includes(lastToken),
    )
    .slice(0, 50);

  const dropdown =
    open && filtered.length > 0
      ? createPortal(
          <div
            style={dropdownStyle}
            className="max-h-56 overflow-auto rounded-xl border border-border/60 bg-card shadow-xl"
          >
            {filtered.map((o) => (
              <button
                type="button"
                key={o.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(applyComboSelection(value, o.value, multi));
                  onType?.("");
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left transition hover:bg-accent/60"
              >
                <span className="block truncate text-sm">{o.label}</span>
                {o.label !== o.value ? (
                  <span className="block truncate text-xs text-muted-foreground">{o.value}</span>
                ) : null}
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapRef} className="relative">
      <input
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          onType?.(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className={inputClassName}
      />
      {dropdown}
    </div>
  );
}
