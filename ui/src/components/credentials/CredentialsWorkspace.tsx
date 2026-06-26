"use client";

// assisted-by claude code claude-sonnet-4-6

import React from "react";

import { ProviderConnections } from "./ProviderConnections";
import { SecretsManager } from "./SecretsManager";

export function CredentialsWorkspace() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Credentials</h1>
        <p className="text-sm text-muted-foreground">
          Keep saved secrets and connected apps in one place. Secret values stay protected after
          you save them.
        </p>
      </div>
      <SecretsManager />
      <hr className="border-border" />
      <ProviderConnections />
    </section>
  );
}
