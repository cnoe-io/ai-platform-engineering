"use client";

import React from "react";

import { Button } from "@/components/ui/button";

export function SecretValueDialog({
  submitLabel,
  onSubmit,
}: {
  submitLabel: string;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = React.useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const submitted = value;
        setValue("");
        void onSubmit(submitted);
      }}
    >
      <label className="space-y-1 text-sm">
        <span>Secret value</span>
        <input
          className="w-full rounded-md border border-input bg-background px-3 py-2"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
          type="password"
        />
      </label>
      <Button type="submit">{submitLabel}</Button>
    </form>
  );
}
