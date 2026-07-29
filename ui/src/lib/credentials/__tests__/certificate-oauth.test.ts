import { constants, verify } from "crypto";

import forge from "node-forge";

import {
  createCertificateClientAssertion,
  inspectCertificatePfx,
} from "../certificate-oauth";

function createTestPfx(password: string): {
  pfxBase64: string;
  certificatePem: string;
} {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "01";
  certificate.validity.notBefore = new Date(Date.now() - 60_000);
  certificate.validity.notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const attributes = [{ name: "commonName", value: "oauth.example.test" }];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [certificate],
    password,
    { algorithm: "3des" },
  );
  const pfxBytes = forge.asn1.toDer(p12).getBytes();
  return {
    pfxBase64: Buffer.from(pfxBytes, "binary").toString("base64"),
    certificatePem: forge.pki.certificateToPem(certificate),
  };
}

describe("certificate OAuth", () => {
  it("validates the PFX thumbprint and signs a Microsoft client assertion", async () => {
    const password = "test-password";
    const { pfxBase64, certificatePem } = createTestPfx(password);
    const inspection = inspectCertificatePfx({ pfxBase64, password });

    expect(inspection.thumbprint).toMatch(/^[0-9A-F]{40}$/);
    expect(() =>
      inspectCertificatePfx({
        pfxBase64,
        password,
        expectedThumbprint: "0".repeat(40),
      }),
    ).toThrow(/does not match/);

    const clientId = "11111111-2222-3333-4444-555555555555";
    const tokenUrl =
      "https://login.microsoftonline.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/oauth2/v2.0/token";
    const assertion = await createCertificateClientAssertion({
      clientId,
      tokenUrl,
      pfxBase64,
      password,
      now: new Date(),
    });
    const [encodedHeader, encodedPayload, encodedSignature] = assertion.split(".");
    const protectedHeader = JSON.parse(
      Buffer.from(encodedHeader, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(protectedHeader).toMatchObject({
      alg: "PS256",
      typ: "JWT",
      "x5t#S256": inspection.x5tS256,
    });
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      aud: tokenUrl,
      iss: clientId,
      sub: clientId,
      jti: expect.any(String),
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
        {
          key: certificatePem,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        },
        Buffer.from(encodedSignature, "base64url"),
      ),
    ).toBe(true);
  });
});
