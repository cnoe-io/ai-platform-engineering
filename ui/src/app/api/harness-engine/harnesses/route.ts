import { authenticateRequest } from "@/lib/da-proxy";
import { getHarnessEngineConfig, proxyHarnessEngine } from "@/lib/harness-engine-proxy";
import { loadRuntimeCatalog } from "@/lib/dynamic-agents/runtime-profiles";
import { readBoundedBody } from "@/lib/dynamic-agents/bounded-body";
import { nativeHarnessDescriptor } from "@/lib/native-harness-catalog";
import type { AgentRuntimeCatalog } from "@/types/dynamic-agent";
import type { HarnessDescriptor } from "@/types/harness-engine";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;
  let nativeCatalog: AgentRuntimeCatalog | undefined;
  try { nativeCatalog = await loadRuntimeCatalog(request); }
  catch { /* Managed native execution remains usable during a profile outage. */ }
  const native = nativeHarnessDescriptor(nativeCatalog);
  let engineCatalog: { contract_version?: number; catalog_revision?: string; harnesses?: HarnessDescriptor[] } = {};
  const config = getHarnessEngineConfig();
  if (!(config instanceof NextResponse)) {
    const response = await proxyHarnessEngine(config, auth, "/api/v1/harnesses", {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    });
    if (response.ok) {
      try {
        const body = JSON.parse(await readBoundedBody(response.body, 256 * 1024));
        if (body.success === true && Array.isArray(body.data?.harnesses)) engineCatalog = body.data;
      } catch { /* An invalid Engine catalog must not remove native profiles. */ }
    }
  }
  return NextResponse.json({ success: true, data: {
    contract_version: engineCatalog.contract_version ?? 1,
    // This revision belongs to Engine draft validation, not the combined projection.
    catalog_revision: engineCatalog.catalog_revision ?? null,
    harnesses: [native, ...(engineCatalog.harnesses ?? []).filter((item) => item.id !== native.id)],
  } }, { headers: { "Cache-Control": "private, no-store" } });
}
