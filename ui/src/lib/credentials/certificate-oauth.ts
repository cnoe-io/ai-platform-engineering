import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  timingSafeEqual,
  X509Certificate,
} from "crypto";

import forge from "node-forge";

import { ApiError } from "@/lib/api-error";

const MAX_PFX_BYTES = 2 * 1024 * 1024;
const ASSERTION_LIFETIME_SECONDS = 10 * 60;

export interface CertificateInspection {
  thumbprint: string;
  thumbprintSha256: string;
  x5tS256: string;
  expiresAt: Date;
}

interface ParsedCertificate extends CertificateInspection {
  privateKeyPkcs8Pem: string;
}

function normalizeThumbprint(value: string): string {
  return value.replace(/[^0-9a-f]/gi, "").toUpperCase();
}

function decodePfx(value: string): Buffer {
  const normalized = value.trim();
  if (!normalized) {
    throw new ApiError("PFX certificate is required", 400, "VALIDATION_ERROR");
  }
  const pfx = Buffer.from(normalized, "base64");
  if (pfx.length === 0 || pfx.length > MAX_PFX_BYTES) {
    throw new ApiError(
      `PFX certificate must be smaller than ${MAX_PFX_BYTES / 1024 / 1024} MiB`,
      400,
      "VALIDATION_ERROR",
    );
  }
  return pfx;
}

function parseCertificatePfx(pfxBase64: string, password: string): ParsedCertificate {
  try {
    const pfx = decodePfx(pfxBase64);
    const p12Asn1 = forge.asn1.fromDer(pfx.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[
      forge.pki.oids.certBag
    ] ?? [];
    const shroudedKeyBags = p12.getBags({
      bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
    })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
    const keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag })[
      forge.pki.oids.keyBag
    ] ?? [];
    const certificate = certBags.find((bag) => bag.cert)?.cert;
    const privateKey = [...shroudedKeyBags, ...keyBags].find((bag) => bag.key)?.key;
    if (!certificate || !privateKey) {
      throw new Error("PFX must contain both a certificate and its private key");
    }

    const certificatePem = forge.pki.certificateToPem(certificate);
    const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
    const x509 = new X509Certificate(certificatePem);
    const nodePrivateKey = createPrivateKey(privateKeyPem);
    if (nodePrivateKey.asymmetricKeyType !== "rsa") {
      throw new Error("Microsoft Entra certificate OAuth requires an RSA private key");
    }

    const certificatePublicKey = x509.publicKey.export({ format: "der", type: "spki" });
    const privatePublicKey = createPublicKey(nodePrivateKey).export({
      format: "der",
      type: "spki",
    });
    if (
      certificatePublicKey.length !== privatePublicKey.length ||
      !timingSafeEqual(certificatePublicKey, privatePublicKey)
    ) {
      throw new Error("PFX certificate does not match its private key");
    }

    const now = Date.now();
    const validFrom = Date.parse(x509.validFrom);
    const validTo = Date.parse(x509.validTo);
    if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || now < validFrom || now >= validTo) {
      throw new Error("PFX certificate is not currently valid");
    }

    const thumbprint = normalizeThumbprint(x509.fingerprint);
    const thumbprintSha256 = normalizeThumbprint(x509.fingerprint256);
    const x5tS256 = createHash("sha256").update(x509.raw).digest("base64url");
    const privateKeyPkcs8Pem = nodePrivateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();

    return {
      thumbprint,
      thumbprintSha256,
      x5tS256,
      expiresAt: new Date(validTo),
      privateKeyPkcs8Pem,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      error instanceof Error
        ? `PFX certificate could not be opened: ${error.message}`
        : "PFX certificate could not be opened",
      400,
      "INVALID_CERTIFICATE",
    );
  }
}

export function inspectCertificatePfx(input: {
  pfxBase64: string;
  password: string;
  expectedThumbprint?: string;
}): CertificateInspection {
  const parsed = parseCertificatePfx(input.pfxBase64, input.password);
  const expectedThumbprint = normalizeThumbprint(input.expectedThumbprint ?? "");
  if (expectedThumbprint && expectedThumbprint !== parsed.thumbprint) {
    throw new ApiError(
      `PFX thumbprint ${parsed.thumbprint} does not match the configured thumbprint`,
      400,
      "CERTIFICATE_THUMBPRINT_MISMATCH",
    );
  }
  return {
    thumbprint: parsed.thumbprint,
    thumbprintSha256: parsed.thumbprintSha256,
    x5tS256: parsed.x5tS256,
    expiresAt: parsed.expiresAt,
  };
}

export async function createCertificateClientAssertion(input: {
  clientId: string;
  tokenUrl: string;
  pfxBase64: string;
  password: string;
  now?: Date;
}): Promise<string> {
  const parsed = parseCertificatePfx(input.pfxBase64, input.password);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const header = Buffer.from(
    JSON.stringify({
      alg: "PS256",
      typ: "JWT",
      "x5t#S256": parsed.x5tS256,
    }),
    "utf8",
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      aud: input.tokenUrl,
      exp: nowSeconds + ASSERTION_LIFETIME_SECONDS,
      iss: input.clientId,
      jti: randomUUID(),
      nbf: nowSeconds - 5,
      iat: nowSeconds,
      sub: input.clientId,
    }),
    "utf8",
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput, "ascii"), {
    key: parsed.privateKeyPkcs8Pem,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }).toString("base64url");
  return `${signingInput}.${signature}`;
}
