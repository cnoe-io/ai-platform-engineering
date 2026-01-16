"use client";

import React from "react";

interface LoadingScreenProps {
  message?: string;
}

/**
 * Branded loading screen with CAIPE logo
 * Used across login, logout, and auth guard screens
 */
export function LoadingScreen({ message = "Loading..." }: LoadingScreenProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(173,80%,40%)]/10 via-transparent to-[hsl(270,75%,60%)]/10" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />

      <div className="relative z-10 flex flex-col items-center gap-6">
        {/* Logo with glow effect */}
        <div className="relative">
          {/* Spinning glow ring */}
          <div
            className="absolute inset-[-8px] rounded-3xl opacity-30"
            style={{
              background: 'linear-gradient(135deg, hsl(173,80%,40%), hsl(270,75%,60%), hsl(330,80%,55%))',
              animation: 'spin 3s linear infinite',
            }}
          />
          {/* Blur glow */}
          <div
            className="absolute inset-[-4px] rounded-2xl blur-xl opacity-40"
            style={{
              background: 'linear-gradient(135deg, hsl(173,80%,40%), hsl(270,75%,60%))',
            }}
          />
          {/* Logo container */}
          <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-[hsl(173,80%,40%)] via-[hsl(270,75%,60%)] to-[hsl(330,80%,55%)] flex items-center justify-center shadow-2xl">
            <img src="/logo.svg" alt="CAIPE" className="h-12 w-12" />
          </div>
        </div>

        {/* Brand name */}
        <div className="text-center">
          <h1 className="text-2xl font-bold gradient-text">CAIPE</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Community AI Platform Engineering
          </p>
        </div>

        {/* Loading indicator */}
        <div className="flex items-center gap-3 mt-2">
          {/* Custom spinner */}
          <div className="relative w-5 h-5">
            <div
              className="absolute inset-0 rounded-full border-2 border-primary/20"
            />
            <div
              className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary"
              style={{ animation: 'spin 0.8s linear infinite' }}
            />
          </div>
          <span className="text-sm text-muted-foreground">{message}</span>
        </div>
      </div>

      {/* Footer */}
      <p className="absolute bottom-6 text-center text-xs text-muted-foreground">
        Powered by OSS{" "}
        <a
          href="https://caipe.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          caipe.io
        </a>
      </p>
    </div>
  );
}
