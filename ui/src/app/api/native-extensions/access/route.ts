import { NextResponse } from "next/server";

import { canEnterNativeExtension } from "@/native-extensions/access";
import { installedNativeExtensionManifests } from "@/native-extensions/manifests.generated";

export async function GET(): Promise<NextResponse> {
  const candidates = installedNativeExtensionManifests
    .filter((manifest) => manifest.navigation)
    .map((manifest) => manifest.id);
  const access = await Promise.all(candidates.map(async (id) => {
    try {
      return await canEnterNativeExtension(id) ? id : null;
    } catch {
      return null;
    }
  }));

  return NextResponse.json(
    { ids: access.filter((id): id is string => id !== null) },
    { headers: { "cache-control": "no-store" } },
  );
}
