import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter, JetBrains_Mono, Source_Sans_3, IBM_Plex_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { TokenExpiryGuard } from "@/components/token-expiry-guard";
import { ThemeInjector } from "@/components/theme-injector";
import { ToastProvider } from "@/components/ui/toast";
import { getServerConfig, getClientConfigScript } from "@/lib/config";
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

  return {
    title: `${cfg.appName} UI`,
    description: fullDescription,
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/icon.ico", sizes: "any" },
      ],
      shortcut: "/favicon.ico",
      apple: "/favicon.ico",
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

  // Build the XSS-safe JSON for client-side config injection.
  // Only client-safe values are included (no secrets).
  const configScript = getClientConfigScript();

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
      >
        <AuthProvider>
          <ThemeProvider
            attribute="data-theme"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange={false}
            themes={["light", "dark", "midnight", "nord", "tokyo"]}
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
