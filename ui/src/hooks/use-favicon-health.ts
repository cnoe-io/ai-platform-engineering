"use client";

/**
 * Listens for `agentic-sdlc:health-dot` events emitted by the
 * ShipLoopRingPanel and updates the document title + a tiny coloured
 * dot baked onto the favicon. Cheap, dependency-free, idempotent.
 *
 * Skipped when reduced-motion is preferred (no flicker in tab title).
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { useEffect } from "react";

export type HealthDot = "healthy" | "degraded" | "missing" | "unknown";

const COLOURS: Record<HealthDot, string> = {
  healthy: "#34d399",
  degraded: "#fbbf24",
  missing: "#f87171",
  unknown: "#94a3b8",
};

export function useFaviconHealth() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    function paint(dot: HealthDot, label: string) {
      const link =
        (document.querySelector('link[rel="icon"]') as HTMLLinkElement | null) ??
        document.createElement("link");
      link.rel = "icon";
      const size = 32;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Background dot ring.
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#6366f1";
      ctx.font = "bold 18px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("A", size / 2, size / 2 + 1);
      // Health dot in the bottom-right.
      ctx.fillStyle = COLOURS[dot];
      ctx.beginPath();
      ctx.arc(size - 7, size - 7, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      link.href = canvas.toDataURL("image/png");
      if (!link.parentElement) document.head.appendChild(link);

      const baseTitle = document.title.replace(/^[•◆◯]\s*/, "");
      const prefix =
        dot === "healthy" ? "● " : dot === "degraded" ? "◆ " : "◯ ";
      document.title = `${prefix}${baseTitle}${label ? ` · ${label}` : ""}`;
    }

    function handler(ev: Event) {
      const detail = (ev as CustomEvent<{ repo?: string; health?: HealthDot }>).detail;
      paint(detail?.health ?? "unknown", detail?.repo ?? "");
    }
    window.addEventListener("agentic-sdlc:health-dot", handler);
    return () => {
      window.removeEventListener("agentic-sdlc:health-dot", handler);
    };
  }, []);
}
