import type { UniversalRebacResourceType } from "@/types/rbac-universal";

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function isOpenFgaSafeObjectId(value: string): boolean {
  return OPENFGA_ID_PATTERN.test(value) && !value.includes(":") && !value.includes("#");
}

export function openFgaResourceId(type: UniversalRebacResourceType, id: string): string {
  if (type !== "llm_model" || isOpenFgaSafeObjectId(id)) {
    return id;
  }
  return `b64_${base64UrlEncode(id)}`;
}

export function openFgaResourceObject(type: UniversalRebacResourceType, id: string): string {
  return `${type}:${openFgaResourceId(type, id)}`;
}
