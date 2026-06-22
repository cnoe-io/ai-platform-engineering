"use client";

import React from "react";

import { Button } from "@/components/ui/button";
import {
  SUPPRESS_PASSWORD_MANAGER_FORM_PROPS,
  SUPPRESS_SECRET_LIKE_INPUT_PROPS,
} from "@/lib/suppress-password-manager";

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
      {...SUPPRESS_PASSWORD_MANAGER_FORM_PROPS}
    >
      <label className="space-y-1 text-sm">
        <span>Secret value</span>
        <input
          className="w-full rounded-md border border-input bg-background px-3 py-2"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
          type="password"
          name=""
          aria-label="Secret value"
          {...SUPPRESS_SECRET_LIKE_INPUT_PROPS}
        />
      </label>
      <Button type="submit">{submitLabel}</Button>
    </form>
  );
}
