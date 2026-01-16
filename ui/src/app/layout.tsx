import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Source_Sans_3, IBM_Plex_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.css";

// Primary font: Inter - Used by OpenAI, clean and highly readable
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Alternative: Source Sans 3 - Adobe's open source, excellent readability
const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  display: "swap",
});

// Alternative: IBM Plex Sans - Professional, used by IBM/Carbon
const ibmPlex = IBM_Plex_Sans({
  variable: "--font-ibm-plex",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// Monospace: JetBrains Mono - Best for code, like VSCode
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CAIPE UI",
  description: "Community AI Platform Engineering - Multi-Agent System for Platform Engineers",
  icons: {
    icon: "/favicon.ico",
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
        <AuthProvider>
          <ThemeProvider
            attribute="data-theme"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange={false}
            themes={["light", "dark", "midnight", "nord", "tokyo"]}
          >
            {children}
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
