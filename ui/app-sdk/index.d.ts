import type { ComponentType } from "react";
import type Link from "next/link";
import type { NativeExtensionContractVersion } from "./contract-version.mjs";

export type { NativeExtensionContractVersion } from "./contract-version.mjs";
export { CONTRACT_VERSION, CHECKER_VERSION, LEGACY_NATIVE_CONTRACT_VERSION, isSupportedNativeContractVersion } from "./contract-version.mjs";

export type { AgenticAppManifest, AgenticAppUiProfile, AgenticAppAuthMode, AgenticAppPolicyAction } from "./agentic-app-manifest.mjs";
export { validateAgenticAppManifest, validateAgenticAppOwnership } from "./agentic-app-manifest.mjs";
export type { NativeExtensionManifest } from "./native-manifest.mjs";

export interface NativeExtensionBreadcrumb {
  label: string;
  href?: string;
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
