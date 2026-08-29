/** @deprecated Use /api/webhooks/github. Kept for existing repository hooks. */

import { POST as canonicalPost } from "@/app/api/webhooks/github/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = canonicalPost;
