import { notFound } from "next/navigation";

import { CredentialsWorkspace } from "@/components/credentials/CredentialsWorkspace";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";

export default function CredentialsPage() {
  if (!getCredentialFeatureConfig().enabled) {
    notFound();
  }

  return (
    <main className="container mx-auto max-w-7xl p-6">
      <CredentialsWorkspace />
    </main>
  );
}
