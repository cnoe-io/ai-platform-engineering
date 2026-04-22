import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getCollection } from "@/lib/mongodb";
import { mergeUserAttributes } from "@/lib/rbac/keycloak-admin";
import type { ObjectId } from "mongodb";

const NONCE_TTL_MS = 10 * 60 * 1000;
const HMAC_TTL_SECONDS = 600; // 10 minutes

type NonceDoc = {
  _id: ObjectId;
  nonce: string;
  slack_user_id: string;
  consumed?: boolean;
  created_at?: Date;
  expires_at?: Date;
};

function isNonceExpired(doc: NonceDoc): boolean {
  const now = Date.now();
  if (doc.expires_at != null) {
    return doc.expires_at.getTime() < now;
  }
  if (doc.created_at != null) {
    return doc.created_at.getTime() + NONCE_TTL_MS < now;
  }
  return true;
}

function validateHmac(slackUserId: string, ts: string, sig: string): boolean {
  const secret = process.env.SLACK_LINK_HMAC_SECRET?.trim()
    || process.env.SLACK_SIGNING_SECRET?.trim()
    || "";
  if (!secret) return false;

  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum)) return false;

  const elapsed = Math.floor(Date.now() / 1000) - tsNum;
  if (elapsed < 0 || elapsed > HMAC_TTL_SECONDS) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${slackUserId}:${ts}`)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(sig, "utf8"),
      Buffer.from(expected, "utf8")
    );
  } catch {
    return false;
  }
}

const LINK_SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Account Linked</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}
.card{background:#fff;border-radius:12px;padding:2rem;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center;max-width:400px}
h1{color:#059669;margin:0 0 .5rem}p{color:#64748b;margin:0}</style></head>
<body><div class="card"><h1>Account Linked!</h1><p>Your Slack account has been linked to your enterprise identity. You can close this window.</p></div></body></html>`;

async function sendSlackLinkConfirmationDm(slackUserId: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) {
    console.warn("[slack-link] SLACK_BOT_TOKEN not set; skipping confirmation DM");
    return;
  }
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: slackUserId,
        text: "Your Slack account has been linked to your enterprise identity. You can now use RBAC-protected commands.",
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) {
      console.error("[slack-link] Slack chat.postMessage failed:", data.error ?? res.status);
    }
  } catch (err) {
    console.error("[slack-link] Slack DM request failed:", err);
  }
}

export async function GET(request: NextRequest) {
  const slackUserIdParam = request.nextUrl.searchParams.get("slack_user_id")?.trim();
  const sig = request.nextUrl.searchParams.get("sig")?.trim();
  const ts = request.nextUrl.searchParams.get("ts")?.trim();
  const nonce = request.nextUrl.searchParams.get("nonce")?.trim();

  if (!slackUserIdParam) {
    return NextResponse.json({ error: "missing slack_user_id" }, { status: 400 });
  }

  // Determine validation mode: HMAC-signed (new) or nonce-based (legacy)
  const isHmacFlow = !!(sig && ts);
  const isNonceFlow = !!nonce;

  if (!isHmacFlow && !isNonceFlow) {
    return NextResponse.json(
      { error: "missing sig+ts or nonce parameters" },
      { status: 400 }
    );
  }

  try {
    // --- Validate the link ---
    if (isHmacFlow) {
      if (!validateHmac(slackUserIdParam, ts!, sig!)) {
        return new NextResponse("This link is invalid or has expired.", {
          status: 400,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
    } else {
      // Legacy nonce flow
      const coll = await getCollection<NonceDoc>("slack_link_nonces");
      const doc = await coll.findOne({ nonce });
      if (!doc || doc.consumed === true || isNonceExpired(doc) || doc.slack_user_id !== slackUserIdParam) {
        return new NextResponse("This link is invalid or has expired.", {
          status: 400,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      // Consume the nonce
      await coll.updateOne(
        { _id: doc._id, consumed: { $ne: true } },
        { $set: { consumed: true } },
      );
    }

    // --- Ensure the user is authenticated via OIDC ---
    const session = await getServerSession(authOptions);
    if (!session?.sub) {
      const base = (process.env.NEXTAUTH_URL || request.nextUrl.origin || "").replace(/\/$/, "");
      const qs = new URLSearchParams();
      qs.set("slack_user_id", slackUserIdParam);
      if (isHmacFlow) {
        qs.set("ts", ts!);
        qs.set("sig", sig!);
      } else {
        qs.set("nonce", nonce!);
      }
      const cb = encodeURIComponent(`${base}/api/auth/slack-link?${qs.toString()}`);
      return NextResponse.redirect(`${base}/login?callbackUrl=${cb}`);
    }

    // --- Link the identity ---
    await mergeUserAttributes(session.sub, { slack_user_id: [slackUserIdParam] });
    await sendSlackLinkConfirmationDm(slackUserIdParam);

    return new NextResponse(LINK_SUCCESS_HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    console.error("[slack-link]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
