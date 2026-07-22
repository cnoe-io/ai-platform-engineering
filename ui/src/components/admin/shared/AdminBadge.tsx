import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AdminBadgeProps {
  className?: string;
}

/**
 * Small "Admin" pill for settings surfaces that only affect the platform
 * (not the signed-in user's personal preferences). Use it on admin-only cards
 * and on the admin section of cards that mix personal + platform controls so
 * admins can tell at a glance which settings apply to everyone.
 */
export function AdminBadge({ className }: AdminBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "uppercase tracking-wide text-muted-foreground border-muted-foreground/40",
        className,
      )}
    >
      Admin
    </Badge>
  );
}
