import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter, JetBrains_Mono, Source_Sans_3, IBM_Plex_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { TokenExpiryGuard } from "@/components/token-expiry-guard";
import { ThemeInjector } from "@/components/theme-injector";
import { ToastProvider } from "@/components/ui/toast";
import { getServerConfig, withSsoOverride } from "@/lib/config";
import { getCollection } from "@/lib/mongodb";
import "./globals.css";

// Primary font: Inter - Used by OpenAI, clean and highly readable
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  fallback: ["system-ui", "arial"],
});

// Alternative: Source Sans 3 - Adobe's open source, excellent readability
const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  display: "swap",
  fallback: ["system-ui", "arial"],
});

// Alternative: IBM Plex Sans - Professional, used by IBM/Carbon
const ibmPlex = IBM_Plex_Sans({
  variable: "--font-ibm-plex",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  fallback: ["system-ui", "arial"],
});

// Monospace: JetBrains Mono - Best for code, like VSCode
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  fallback: ["monospace", "Courier New"],
});

/**
 * Dynamic metadata — reads process.env at request time so branding
 * reflects runtime env vars, not build-time values.
 */
export async function generateMetadata(): Promise<Metadata> {
  const cfg = getServerConfig();
  const fullDescription = `${cfg.tagline} - ${cfg.description}`;

  const faviconUrl = cfg.faviconUrl || "/favicon.ico";

  return {
    title: `${cfg.appName} UI`,
    description: fullDescription,
    icons: {
      icon: [
        { url: faviconUrl, sizes: "any" },
      ],
      shortcut: faviconUrl,
      apple: faviconUrl,
    },
    openGraph: {
      title: `${cfg.appName} UI`,
      description: fullDescription,
      url: "https://caipe.example.com",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Force dynamic rendering so config reads process.env at request time,
  // not at build time when env vars are empty.
  await headers();

  // Start with env-var config, then overlay DB-backed feature flag overrides.
  // This lets admins toggle features from the System → Options dialog without
  // touching env vars or Kubernetes secrets. Env vars always take precedence.
  const baseCfg = getServerConfig();
  let dbSsoEnabled = false;
  let dbRagEnabled: boolean | null = null;
  let dbDynamicAgentsEnabled: boolean | null = null;

  if (process.env.MONGODB_URI) {
    try {
      const platformConfig = await getCollection<{ _id: string; enabled?: boolean; flags?: Record<string, boolean> }>('platform_config');

      // SSO: read from oidc_config.enabled
      if (!baseCfg.ssoEnabled) {
        const oidcDoc = await platformConfig.findOne({ _id: 'oidc_config' as any });
        dbSsoEnabled = oidcDoc?.enabled === true;
      }

      // Other feature flags: read from feature_flags doc (only when env var is not set)
      const flagsDoc = await platformConfig.findOne({ _id: 'feature_flags' as any });
      if (flagsDoc?.flags) {
        // Only use DB value if the env var is NOT explicitly set
        if (process.env.RAG_ENABLED === undefined && flagsDoc.flags.rag_enabled !== undefined) {
          dbRagEnabled = flagsDoc.flags.rag_enabled;
        }
        if (process.env.DYNAMIC_AGENTS_ENABLED === undefined && flagsDoc.flags.dynamic_agents_enabled !== undefined) {
          dbDynamicAgentsEnabled = flagsDoc.flags.dynamic_agents_enabled;
        }
      }
    } catch {
      // MongoDB unavailable — fall through with env-only config
    }
  }

  let cfg = withSsoOverride(baseCfg, dbSsoEnabled);

  // Apply DB-backed feature flag overrides
  if (dbRagEnabled !== null) cfg = { ...cfg, ragEnabled: dbRagEnabled };
  if (dbDynamicAgentsEnabled !== null) cfg = { ...cfg, dynamicAgentsEnabled: dbDynamicAgentsEnabled };

  // Build the XSS-safe JSON for client-side config injection.
  // Only client-safe values are included (no secrets).
  const configScript = JSON.stringify(cfg).replace(/</g, '\\u003c');

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inject client config synchronously before any JS runs */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__APP_CONFIG__=${configScript};`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${sourceSans.variable} ${ibmPlex.variable} ${jetbrainsMono.variable} font-sans antialiased`}
        data-font-size={cfg.defaultFontSize}
        data-font-family={cfg.defaultFontFamily}
      >
        <AuthProvider>
          <ThemeProvider
            attribute="data-theme"
            defaultTheme={cfg.defaultTheme}
            enableSystem
            disableTransitionOnChange={false}
            themes={["light", "dark", "midnight", "nord", "tokyo", "cyberpunk", "tron", "matrix"]}
          >
            <ToastProvider>
              <ThemeInjector />
              <TokenExpiryGuard />
              {children}
            </ToastProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
