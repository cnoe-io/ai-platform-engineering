import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { ApiError } from "@/lib/api-middleware";
import { findRealmUserIdByAttribute, mergeUserAttributes } from "@/lib/rbac/keycloak-admin";
import {
  consumeWebexLinkNonce,
  findValidWebexLinkNonce,
  mintWebexLinkNonceFromHmac,
} from "@/lib/rbac/webex-link-nonce";

const HMAC_TTL_SECONDS = 600;

function validateHmac(webexUserId: string, ts: string, sig: string): boolean {
  const secret =
    process.env.WEBEX_LINK_HMAC_SECRET?.trim() || process.env.WEBEX_SIGNING_SECRET?.trim() || "";
  if (!secret) return false;

  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum)) return false;

  const elapsed = Math.floor(Date.now() / 1000) - tsNum;
  if (elapsed < 0 || elapsed > HMAC_TTL_SECONDS) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${webexUserId}:${ts}`).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"));
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
<body><div class="card"><h1>Account Linked!</h1><p>Your Webex account has been linked to your enterprise identity. You can close this window.</p></div></body></html>`;

function invalidLinkResponse(): NextResponse {
  return new NextResponse("This link is invalid or has expired.", {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function buildNonceCallbackUrl(base: string, webexUserId: string, nonce: string): string {
  const qs = new URLSearchParams();
  qs.set("webex_user_id", webexUserId);
  qs.set("nonce", nonce);
  return `${base}/api/auth/webex-link?${qs.toString()}`;
}

async function assertWebexIdNotLinkedToOtherUser(webexUserId: string, keycloakSub: string): Promise<void> {
  const existingOwner = await findRealmUserIdByAttribute("webex_user_id", webexUserId);
  if (existingOwner && existingOwner !== keycloakSub) {
    throw new ApiError(
      "This Webex account is already linked to a different enterprise user.",
      409,
      "WEBEX_ID_ALREADY_LINKED"
    );
  }
}

export async function GET(request: NextRequest) {
  const webexUserIdParam = request.nextUrl.searchParams.get("webex_user_id")?.trim();
  const sig = request.nextUrl.searchParams.get("sig")?.trim();
  const ts = request.nextUrl.searchParams.get("ts")?.trim();
  const nonceParam = request.nextUrl.searchParams.get("nonce")?.trim();

  if (!webexUserIdParam) {
    return NextResponse.json({ error: "missing webex_user_id" }, { status: 400 });
  }

  const isHmacFlow = !!(sig && ts);
  const isNonceFlow = !!nonceParam;

  if (!isHmacFlow && !isNonceFlow) {
    return NextResponse.json({ error: "missing nonce parameter" }, { status: 400 });
  }

  try {
    if (isHmacFlow) {
      if (!validateHmac(webexUserIdParam, ts!, sig!)) {
        return invalidLinkResponse();
      }
      try {
        const { nonce } = await mintWebexLinkNonceFromHmac(webexUserIdParam, ts!);
        const base = (process.env.NEXTAUTH_URL || request.nextUrl.origin || "").replace(/\/$/, "");
        return NextResponse.redirect(buildNonceCallbackUrl(base, webexUserIdParam, nonce));
      } catch {
        return invalidLinkResponse();
      }
    }

    const nonceDoc = await findValidWebexLinkNonce(nonceParam!, webexUserIdParam);
    if (!nonceDoc) {
      return invalidLinkResponse();
    }

    const session = await getServerSession(authOptions);
    if (!session?.sub) {
      const base = (process.env.NEXTAUTH_URL || request.nextUrl.origin || "").replace(/\/$/, "");
      const cb = encodeURIComponent(buildNonceCallbackUrl(base, webexUserIdParam, nonceParam!));
      return NextResponse.redirect(`${base}/login?callbackUrl=${cb}`);
    }

    await assertWebexIdNotLinkedToOtherUser(webexUserIdParam, session.sub);
    await mergeUserAttributes(session.sub, { webex_user_id: [webexUserIdParam] });

    const consumed = await consumeWebexLinkNonce(nonceParam!, webexUserIdParam);
    if (!consumed) {
      return invalidLinkResponse();
    }

    return new NextResponse(LINK_SUCCESS_HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    }
    console.error("[webex-link]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
