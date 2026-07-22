"use client";

import { Card,CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertCircle,Loader2 } from "lucide-react";
import type { ReactNode } from "react";

interface AsyncStatsCardProps {
  children?: ReactNode;
  className?: string;
  error?: string | null;
  loading: boolean;
  minHeightClassName?: string;
  testId: string;
}

export function AsyncStatsCard({
  children,
  className,
  error,
  loading,
  minHeightClassName = "min-h-40",
  testId,
}: AsyncStatsCardProps) {
  return (
    <div
      aria-busy={loading}
      className={cn("relative h-full", className)}
      data-testid={testId}
    >
      {children ?? (
        <Card className={cn("h-full", minHeightClassName)}>
          <CardContent className="flex h-full min-h-[inherit] items-center justify-center p-6">
            {!loading && error && (
              <div className="flex max-w-sm items-center gap-2 text-center text-sm text-destructive" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-card/70 backdrop-blur-[1px]">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading card" />
        </div>
      )}

      {!loading && error && children && (
        <div
          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive"
          role="alert"
          title={error}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          Refresh failed
        </div>
      )}
    </div>
  );
}
