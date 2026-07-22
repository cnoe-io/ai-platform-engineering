"use client";

import { Button } from "@/components/ui/button";
import { Calendar,ChevronDown } from "lucide-react";
import { useEffect,useId,useRef,useState } from "react";

export type DateRangePreset = "1h" | "12h" | "24h" | "7d" | "30d" | "90d" | "custom";

export interface DateRange {
  from: string; // ISO string
  to: string;   // ISO string
}

interface DateRangeFilterProps {
  value: DateRangePreset;
  customRange?: DateRange;
  onChange: (preset: DateRangePreset, range: DateRange) => void;
}

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "12h", label: "12h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

function presetToRange(preset: DateRangePreset): DateRange {
  const now = new Date();
  const to = now.toISOString();
  const from = new Date(now);
  switch (preset) {
    case "1h":  from.setHours(from.getHours() - 1); break;
    case "12h": from.setHours(from.getHours() - 12); break;
    case "24h": from.setDate(from.getDate() - 1); break;
    case "7d":  from.setDate(from.getDate() - 7); break;
    case "30d": from.setDate(from.getDate() - 30); break;
    case "90d": from.setDate(from.getDate() - 90); break;
    default:    from.setDate(from.getDate() - 30); break;
  }
  return { from: from.toISOString(), to };
}

function toDateInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateInputToLocalBoundary(value: string, endOfDay: boolean): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
}

export function DateRangeFilter({ value, customRange, onChange }: DateRangeFilterProps) {
  const id = useId();
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(
    () => customRange ? toDateInputValue(customRange.from) : toDateInputValue(new Date(Date.now() - 30 * 86400000).toISOString())
  );
  const [customTo, setCustomTo] = useState(
    () => customRange ? toDateInputValue(customRange.to) : toDateInputValue(new Date().toISOString())
  );
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!customOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setCustomOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCustomOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [customOpen]);

  const handlePreset = (preset: DateRangePreset) => {
    setCustomOpen(false);
    onChange(preset, presetToRange(preset));
  };

  const handleCustomApply = () => {
    const from = dateInputToLocalBoundary(customFrom, false);
    const to = dateInputToLocalBoundary(customTo, true);
    onChange("custom", { from: from.toISOString(), to: to.toISOString() });
    setCustomOpen(false);
  };

  const customLabel = value === "custom" && customRange
    ? `${toDateInputValue(customRange.from)} – ${toDateInputValue(customRange.to)}`
    : "Custom";

  return (
    <div className="relative flex items-center">
      <div className="flex rounded-md border overflow-hidden">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => handlePreset(p.value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              value === p.value
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          ref={triggerRef}
          onClick={() => setCustomOpen(!customOpen)}
          className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1 ${
            value === "custom"
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-muted"
          }`}
        >
          <Calendar className="h-3 w-3" />
          {customLabel}
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {customOpen && (
        <div
          ref={dropdownRef}
          className="absolute right-0 top-full mt-2 z-50 rounded-lg bg-popover text-popover-foreground shadow-lg border border-border p-3 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2"
        >
          <div className="space-y-3">
            <div className="text-xs font-medium">Custom Date Range</div>
            <div className="flex items-center gap-2">
              <div className="space-y-1">
                <label htmlFor={`${id}-from`} className="text-[10px] text-muted-foreground">From</label>
                <input
                  id={`${id}-from`}
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  max={customTo}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <span className="text-muted-foreground mt-4">–</span>
              <div className="space-y-1">
                <label htmlFor={`${id}-to`} className="text-[10px] text-muted-foreground">To</label>
                <input
                  id={`${id}-to`}
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  min={customFrom}
                  max={toDateInputValue(new Date().toISOString())}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              disabled={!customFrom || !customTo || customFrom > customTo}
              onClick={handleCustomApply}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export { presetToRange };
