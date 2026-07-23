import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SettingsCardProps {
  children: React.ReactNode;
  className?: string;
  description?: React.ReactNode;
  title: React.ReactNode;
}

export function SettingsCard({
  children,
  className,
  description,
  title,
}: SettingsCardProps): React.ReactElement {
  return (
    <Card className={cn("overflow-hidden",className)}>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
