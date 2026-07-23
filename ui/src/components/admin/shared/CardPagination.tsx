"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import React from "react";

interface CardPaginationProps {
  disabled?: boolean;
  label: string;
  onPageChange: (page: number) => void;
  page: number;
  pageSize: number;
  total: number;
  className?: string;
}

/**
 * Compact pagination for tables and leaderboards embedded inside admin cards.
 * Pages are 1-based. The number input supports direct navigation while the
 * Previous/Next buttons preserve the familiar card pager interaction.
 */
export function CardPagination({
  className,
  disabled = false,
  label,
  onPageChange,
  page,
  pageSize,
  total,
}: CardPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const safePage = Math.min(Math.max(1, page), totalPages);
  const firstItem = (safePage - 1) * pageSize + 1;
  const lastItem = Math.min(safePage * pageSize, total);
  const inputId = `${label.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}-page`;

  const goToPage = (requestedPage: number): void => {
    const nextPage = Math.min(Math.max(1, requestedPage), totalPages);
    if (nextPage !== safePage) onPageChange(nextPage);
  };

  return (
    <div
      className={cn(
        "mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground",
        className,
      )}
    >
      <span>
        Showing {firstItem}–{lastItem} of {total}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const requestedPage = Number.parseInt(String(form.get("page") ?? ""), 10);
            if (Number.isFinite(requestedPage)) goToPage(requestedPage);
          }}
        >
          <label htmlFor={inputId}>Page</label>
          <Input
            key={safePage}
            id={inputId}
            name="page"
            type="number"
            min={1}
            max={totalPages}
            defaultValue={safePage}
            disabled={disabled}
            className="h-8 w-14 px-2 text-center text-xs text-foreground"
            aria-label={`Go to ${label} page`}
          />
          <span>of {totalPages}</span>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="h-8 px-2"
            disabled={disabled}
          >
            Go
          </Button>
        </form>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={disabled || safePage <= 1}
          onClick={() => goToPage(safePage - 1)}
          aria-label={`Previous ${label} page`}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={disabled || safePage >= totalPages}
          onClick={() => goToPage(safePage + 1)}
          aria-label={`Next ${label} page`}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
