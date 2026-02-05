"use client";

import { useEffect } from "react";
import { getConfig } from "@/lib/config";

/**
 * ThemeInjector component
 * 
 * Injects custom CSS variables for gradient colors and spinner at runtime.
 * This allows the theme to be customized via environment variables.
 */
export function ThemeInjector() {
  useEffect(() => {
    const gradientFrom = getConfig('gradientFrom');
    const gradientTo = getConfig('gradientTo');
    const spinnerColor = getConfig('spinnerColor');
    
    // Debug logging
    console.log('[ThemeInjector] Applying theme:', { gradientFrom, gradientTo, spinnerColor });
    
    const root = document.documentElement;
    
    if (gradientFrom) {
      root.style.setProperty('--gradient-from', gradientFrom);
    }
    
    if (gradientTo) {
      root.style.setProperty('--gradient-to', gradientTo);
    }
    
    if (spinnerColor) {
      root.style.setProperty('--spinner-color', spinnerColor);
    }
  }, []);

  return null;
}
