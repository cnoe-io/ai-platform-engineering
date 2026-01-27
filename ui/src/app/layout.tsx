import type { Metadata } from "next";
import Script from "next/script";
import { Inter, JetBrains_Mono, Source_Sans_3, IBM_Plex_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { TokenExpiryGuard } from "@/components/token-expiry-guard";
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

export const metadata: Metadata = {
  title: "CAIPE UI",
  description: "Community AI Platform Engineering - Multi-Agent System for Platform Engineers",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
  openGraph: {
    title: "CAIPE UI",
    description: "Community AI Platform Engineering - Multi-Agent System for Platform Engineers",
    url: "https://caipe-ui.dev.outshift.io",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${sourceSans.variable} ${ibmPlex.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <Script src="/env-config.js" strategy="beforeInteractive" />
        <AuthProvider>
          <ThemeProvider
            attribute="data-theme"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange={false}
            themes={["light", "dark", "midnight", "nord", "tokyo"]}
          >
            <TokenExpiryGuard />
            {children}
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
