"use client";

import {
  WorkspaceSectionNavigation,
  type WorkspaceNavigationGroup,
} from "@/components/layout/WorkspaceNavigation";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { Cable,KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import React from "react";

import { ProviderConnections } from "./ProviderConnections";
import { SecretsManager } from "./SecretsManager";

export type CredentialsSection = "connections" | "secrets";

const CREDENTIALS_GROUPS: WorkspaceNavigationGroup[] = [{
  id: "credentials-sections",
  items: [
    {
      id: "connections",
      label: "Connected apps",
      href: "/credentials/connections",
      icon: Cable,
      description: "Manage OAuth connections",
    },
    {
      id: "secrets",
      label: "Saved secrets",
      href: "/credentials/secrets",
      icon: KeyRound,
      description: "Store protected credentials",
    },
  ],
}];

export function CredentialsWorkspace({
  activeSection,
}: {
  activeSection: CredentialsSection;
}): React.ReactElement {
  const router = useRouter();

  const showConnections = React.useCallback(() => {
    router.replace("/credentials/connections");
  }, [router]);

  React.useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "caipe.oauth.connection") return;
      showConnections();
    };

    window.addEventListener("message",handleOAuthMessage);
    return () => window.removeEventListener("message",handleOAuthMessage);
  }, [showConnections]);

  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("caipe.oauth.connection");
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === "caipe.oauth.connection") showConnections();
    };
    channel.addEventListener("message",handleOAuthMessage);
    return () => {
      channel.removeEventListener("message",handleOAuthMessage);
      channel.close();
    };
  }, [showConnections]);

  return (
    <section>
      <WorkspaceHeader
        description="Manage connected apps and saved secrets."
        icon={KeyRound}
        iconAnimationClassName="motion-safe:duration-300 motion-safe:group-hover:-rotate-12 motion-safe:group-hover:scale-110"
        iconTestId="credentials-header-icon"
        title="Credentials"
      />

      <div className="space-y-6 lg:flex lg:items-start lg:gap-10 lg:space-y-0">
        <WorkspaceSectionNavigation
          activeItemId={activeSection}
          groups={CREDENTIALS_GROUPS}
          navigationLabel="Credentials sections"
          pickerLabel="Credentials section"
        />

        <div className="min-w-0 flex-1">
          {activeSection === "connections" ? <ProviderConnections /> : <SecretsManager />}
        </div>
      </div>
    </section>
  );
}
