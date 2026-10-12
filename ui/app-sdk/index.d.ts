import type { ComponentType } from "react";
import type Link from "next/link";
import type { NativeExtensionContractVersion } from "./contract-version.mjs";

export type { NativeExtensionContractVersion } from "./contract-version.mjs";
export { CONTRACT_VERSION, CHECKER_VERSION, LEGACY_NATIVE_CONTRACT_VERSION, isSupportedNativeContractVersion } from "./contract-version.mjs";

export type { AgenticAppManifest, AgenticAppUiProfile, AgenticAppAuthMode, AgenticAppPolicyAction } from "./agentic-app-manifest.mjs";
export { validateAgenticAppManifest, validateAgenticAppOwnership } from "./agentic-app-manifest.mjs";

export interface NativeExtensionBreadcrumb {
  label: string;
  href?: string;
}

export interface NativeExtensionManifest {
  id: string;
  displayName: string;
  description: string;
  /** New publishers use 2.0; 1.1 is retained only for compatibility. */
  contractVersion: NativeExtensionContractVersion;
  hostPaths: string[];
  slots?: Array<"home">;
  navigation?: {
    label: string;
    href: string;
    placement: "after-chat";
    icon?: "book-open" | "layout-grid";
  };
  assistant?: {
    agentId: string;
    label: string;
    name: string;
  };
  api: {
    appId: string;
    basePath: string;
    mounts: string[];
  };
  auth: {
    mode: "app-scoped-token" | "forward-user-access-token";
  };
}

export interface NativeExtensionProps {
  apiBasePath: string;
  pathname: string;
  search: string;
  navigate: (href: string) => void;
  Link?: typeof Link;
  setBreadcrumbs: (breadcrumbs: NativeExtensionBreadcrumb[]) => void;
}

export interface NativeExtensionModule {
  Component: ComponentType<NativeExtensionProps>;
  /** Must equal the manifest profile's version; new publishers use 2.0. */
  contractVersion: NativeExtensionContractVersion;
}
