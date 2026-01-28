"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, X, Type, Palette, Monitor, Check } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Font size options
const fontSizes = [
  { id: "small", label: "Small", size: "14px" },
  { id: "medium", label: "Medium", size: "16px" },
  { id: "large", label: "Large", size: "18px" },
  { id: "x-large", label: "Extra Large", size: "20px" },
] as const;

// Font family options
const fontFamilies = [
  { id: "inter", label: "Inter", description: "Clean & Modern (OpenAI)" },
  { id: "source-sans", label: "Source Sans", description: "Highly Readable (Adobe)" },
  { id: "ibm-plex", label: "IBM Plex", description: "Professional (IBM Carbon)" },
  { id: "system", label: "System", description: "Native OS Font" },
] as const;

// Theme options
const themes = [
  { id: "light", label: "Light", description: "Bright & clean" },
  { id: "dark", label: "Dark", description: "Easy on the eyes" },
  { id: "midnight", label: "Midnight", description: "Pure black (OLED)" },
  { id: "nord", label: "Nord", description: "Arctic cool" },
  { id: "tokyo", label: "Tokyo Night", description: "Vibrant purple" },
] as const;

// Gradient theme options
const gradientThemes = [
  { 
    id: "default", 
    label: "Default (Teal → Purple)", 
    description: "Original vibrant gradient",
    from: "hsl(173,80%,40%)", 
    to: "hsl(270,75%,60%)",
    preview: "from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)]"
  },
  { 
    id: "minimal", 
    label: "Minimal (Gray → Dark Gray)", 
    description: "Subtle, professional",
    from: "hsl(220,10%,40%)", 
    to: "hsl(220,10%,25%)",
    preview: "from-gray-600 to-gray-800"
  },
  { 
    id: "professional", 
    label: "Professional (Blue → Navy)", 
    description: "Corporate, trustworthy",
    from: "hsl(210,60%,50%)", 
    to: "hsl(210,80%,30%)",
    preview: "from-blue-500 to-blue-800"
  },
  { 
    id: "ocean", 
    label: "Ocean (Cyan → Blue)", 
    description: "Cool, calming",
    from: "hsl(195,80%,45%)", 
    to: "hsl(220,80%,45%)",
    preview: "from-cyan-500 to-blue-600"
  },
  { 
    id: "sunset", 
    label: "Sunset (Orange → Pink)", 
    description: "Warm, energetic",
    from: "hsl(30,80%,55%)", 
    to: "hsl(340,70%,55%)",
    preview: "from-orange-500 to-pink-500"
  },
] as const;

type FontSize = typeof fontSizes[number]["id"];
type FontFamily = typeof fontFamilies[number]["id"];
type GradientTheme = typeof gradientThemes[number]["id"];

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [fontSize, setFontSize] = useState<FontSize>("medium");
  const [fontFamily, setFontFamily] = useState<FontFamily>("inter");
  const [gradientTheme, setGradientTheme] = useState<GradientTheme>("default");
  const [mounted, setMounted] = useState(false);

  // Load settings from localStorage
  useEffect(() => {
    setMounted(true);
    const savedFontSize = localStorage.getItem("caipe-font-size") as FontSize | null;
    const savedFontFamily = localStorage.getItem("caipe-font-family") as FontFamily | null;
    const savedGradientTheme = localStorage.getItem("caipe-gradient-theme") as GradientTheme | null;

    if (savedFontSize) {
      setFontSize(savedFontSize);
      document.body.setAttribute("data-font-size", savedFontSize);
    }
    if (savedFontFamily) {
      setFontFamily(savedFontFamily);
      document.body.setAttribute("data-font-family", savedFontFamily);
    }
    if (savedGradientTheme) {
      setGradientTheme(savedGradientTheme);
      applyGradientTheme(savedGradientTheme);
    } else {
      // Apply default theme
      applyGradientTheme("default");
    }
  }, []);

  // Apply font size
  const handleFontSizeChange = (size: FontSize) => {
    setFontSize(size);
    localStorage.setItem("caipe-font-size", size);
    document.body.setAttribute("data-font-size", size);
  };

  // Apply font family
  const handleFontFamilyChange = (family: FontFamily) => {
    setFontFamily(family);
    localStorage.setItem("caipe-font-family", family);
    document.body.setAttribute("data-font-family", family);
  };

  // Apply gradient theme
  const applyGradientTheme = (themeId: GradientTheme) => {
    const selectedTheme = gradientThemes.find(t => t.id === themeId);
    if (selectedTheme) {
      document.documentElement.style.setProperty("--gradient-from", selectedTheme.from);
      document.documentElement.style.setProperty("--gradient-to", selectedTheme.to);
      document.documentElement.setAttribute("data-gradient-theme", themeId);
    }
  };

  const handleGradientThemeChange = (themeId: GradientTheme) => {
    setGradientTheme(themeId);
    localStorage.setItem("caipe-gradient-theme", themeId);
    applyGradientTheme(themeId);
  };

  if (!mounted) return null;

  const modalContent = (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999]"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-96 bg-card border-l border-border shadow-2xl z-[9999] overflow-y-auto"
          >
              {/* Header */}
              <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-b border-border p-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Settings</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="p-4 space-y-6">
                {/* Font Size Section */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Type className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-medium">Font Size</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {fontSizes.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => handleFontSizeChange(option.id)}
                        className={cn(
                          "flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all",
                          fontSize === option.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:border-primary/50 hover:bg-muted/50"
                        )}
                      >
                        <div className="flex flex-col items-start">
                          <span className="text-sm font-medium">{option.label}</span>
                          <span className="text-2xs text-muted-foreground">{option.size}</span>
                        </div>
                        {fontSize === option.id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Font Family Section */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Type className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-medium">Font Family</h3>
                  </div>
                  <div className="space-y-2">
                    {fontFamilies.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => handleFontFamilyChange(option.id)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all text-left",
                          fontFamily === option.id
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50 hover:bg-muted/50"
                        )}
                      >
                        <div>
                          <span
                            className={cn(
                              "text-sm font-medium block",
                              option.id === "inter" && "font-inter",
                              option.id === "source-sans" && "font-source-sans",
                              option.id === "ibm-plex" && "font-ibm-plex"
                            )}
                          >
                            {option.label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        </div>
                        {fontFamily === option.id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Theme Section */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-medium">Theme</h3>
                  </div>
                  <div className="space-y-2">
                    {themes.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setTheme(option.id)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all text-left",
                          theme === option.id
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50 hover:bg-muted/50"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "w-6 h-6 rounded-full border-2",
                              option.id === "light" && "bg-white border-gray-200",
                              option.id === "dark" && "bg-[#0a0b0f] border-[#1e2028]",
                              option.id === "midnight" && "bg-black border-gray-800",
                              option.id === "nord" && "bg-[#2e3440] border-[#3b4252]",
                              option.id === "tokyo" && "bg-[#1a1b26] border-[#24283b]"
                            )}
                          />
                          <div>
                            <span className="text-sm font-medium block">{option.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {option.description}
                            </span>
                          </div>
                        </div>
                        {theme === option.id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Gradient Theme Section */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-medium">Gradient Theme</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Choose the gradient style used throughout the interface
                  </p>
                  <div className="space-y-2">
                    {gradientThemes.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => handleGradientThemeChange(option.id)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all text-left",
                          gradientTheme === option.id
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50 hover:bg-muted/50"
                        )}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div
                            className={cn(
                              "w-10 h-10 rounded-lg bg-gradient-to-br shrink-0",
                              option.preview
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium block truncate">{option.label}</span>
                            <span className="text-xs text-muted-foreground block truncate">
                              {option.description}
                            </span>
                          </div>
                        </div>
                        {gradientTheme === option.id && (
                          <Check className="h-4 w-4 text-primary ml-2 shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Preview Section */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Monitor className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-medium">Preview</h3>
                  </div>
                  <div
                    className="p-4 rounded-lg border border-border bg-background"
                    style={{
                      fontFamily: fontFamily === "inter" ? "var(--font-inter), system-ui, sans-serif"
                        : fontFamily === "source-sans" ? "var(--font-source-sans), system-ui, sans-serif"
                        : fontFamily === "ibm-plex" ? "var(--font-ibm-plex), system-ui, sans-serif"
                        : "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
                      fontSize: fontSize === "small" ? "14px"
                        : fontSize === "large" ? "18px"
                        : fontSize === "x-large" ? "20px"
                        : "16px",
                    }}
                  >
                    <p className="mb-2">
                      The quick brown fox jumps over the lazy dog.
                    </p>
                    <p className="text-muted-foreground mb-2" style={{ fontSize: "0.85em" }}>
                      ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789
                    </p>
                    <code className="font-mono bg-muted px-2 py-1 rounded" style={{ fontSize: "0.85em" }}>
                      const agent = new A2AAgent();
                    </code>
                  </div>
                </section>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
  );

  return (
    <>
      {/* Settings Button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setOpen(true)}
        title="Settings"
      >
        <Settings className="h-4 w-4" />
      </Button>

      {/* Render modal in portal to ensure it's above everything */}
      {typeof document !== "undefined" && createPortal(modalContent, document.body)}
    </>
  );
}
