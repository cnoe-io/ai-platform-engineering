import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getCollection } from "@/lib/mongodb";
import { mergeUserAttributes } from "@/lib/rbac/keycloak-admin";
import type { ObjectId } from "mongodb";

type NonceDoc = {
  _id: ObjectId;
  nonce: string;
  slack_user_id: string;
  expires_at: Date;
};

export async function GET(request: NextRequest) {
  const nonce = request.nextUrl.searchParams.get("nonce")?.trim();
  if (!nonce) {
    return NextResponse.json({ error: "missing nonce" }, { status: 400 });
  }

  try {
    const coll = await getCollection<NonceDoc>("slack_link_nonces");
    const doc = await coll.findOne({ nonce });
    if (!doc || doc.expires_at < new Date()) {
      return new NextResponse("This link is invalid or has expired.", {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const session = await getServerSession(authOptions);
    if (!session?.sub) {
      const base = (process.env.NEXTAUTH_URL || request.nextUrl.origin || "").replace(/\/$/, "");
      const cb = encodeURIComponent(`/api/auth/slack-link?nonce=${encodeURIComponent(nonce)}`);
      return NextResponse.redirect(`${base}/api/auth/signin/oidc?callbackUrl=${cb}`);
    }

    await mergeUserAttributes(session.sub, { slack_user_id: [doc.slack_user_id] });
    await coll.deleteOne({ _id: doc._id });

    return new NextResponse(
      "Your Slack account has been linked. You can close this window.",
      { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  } catch (e) {
    console.error("[slack-link]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
