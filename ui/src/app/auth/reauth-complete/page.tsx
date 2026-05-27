"use client";

import { useEffect, useState } from "react";

/**
 * ReauthCompletePage — the OIDC callback destination for new-tab silent re-auth.
 *
 * Flow:
 *   1. TokenExpiryGuard opens a new tab:
 *        /api/auth/signin/oidc?callbackUrl=/auth/reauth-complete
 *   2. OIDC completes and NextAuth redirects here.
 *   3. This page broadcasts SESSION_REFRESHED on "caipe-auth" so the opener
 *      tab silently calls updateSession() without any page reload.
 *   4. The tab closes itself. If window.close() is blocked by the browser,
 *      a fallback message tells the user they can close it manually.
 */
export default function ReauthCompletePage() {
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    // Notify the opener tab that authentication succeeded.
    try {
      const channel = new BroadcastChannel("caipe-auth");
      channel.postMessage({ type: "SESSION_REFRESHED" });
      channel.close();
    } catch {
      // BroadcastChannel not supported — the opener will pick up the new
      // session via NextAuth's refetchOnWindowFocus instead.
    }

    // Close this tab. Works when the tab was opened via window.open(); a
    // browser may silently ignore this if the tab was opened any other way.
    window.close();

    // If we are still here the browser blocked the close; show fallback UI.
    setClosed(true);
  }, []);

  if (!closed) {
    // Brief flash while the effect fires — normally never visible.
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-2 p-6">
        <p className="text-sm font-medium text-foreground">
          Authentication complete.
        </p>
        <p className="text-xs text-muted-foreground">
          You can close this tab.
        </p>
      </div>
    </div>
  );
}
