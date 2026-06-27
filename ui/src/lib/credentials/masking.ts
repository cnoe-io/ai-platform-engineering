const SENSITIVE_DETAIL_KEY_PATTERN = /(secret|token|password|credential|plaintext|privateKey)/i;

export function maskCredentialValue(value: string): string {
  if (value.length === 0) {
    return "";
  }
  if (value.length === 1) {
    return "*";
  }
  if (value.length <= 4) {
    return `${value.slice(0, 1)}${"*".repeat(value.length - 1)}`;
  }
  if (value.length <= 8) {
    return `${value.slice(0, 1)}...${value.slice(-1)}`;
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function isOpaqueMaskedPreview(value: string): boolean {
  return value.length > 1 && /^\*+$/.test(value);
}

export function redactCredentialDetails<T extends Record<string, unknown>>(details: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      SENSITIVE_DETAIL_KEY_PATTERN.test(key) ? "[redacted]" : value,
    ]),
  );
}
