import { getHarnessPresentation } from "@/lib/agent-presentation";
import { cn } from "@/lib/utils";
import { Cpu } from "lucide-react";

interface AgentHarnessBadgeProps {
  harnessId?: string | null;
  compact?: boolean;
  context?: "configured" | "execution";
  className?: string;
}

export function AgentHarnessBadge({
  harnessId,
  compact = false,
  context = "execution",
  className,
}: AgentHarnessBadgeProps) {
  const harness = getHarnessPresentation(harnessId);
  const label = `${context === "configured" ? "Configured harness" : "Execution harness"}: ${harness.label}`;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border font-medium leading-none",
        compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]",
        harness.badgeClassName,
        className,
      )}
      title={label}
      aria-label={label}
    >
      <Cpu className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} aria-hidden="true" />
      {compact ? harness.shortLabel : harness.label}
    </span>
  );
}
