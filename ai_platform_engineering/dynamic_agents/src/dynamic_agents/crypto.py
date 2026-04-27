"""Envelope encryption for MCP server secrets.

Mirrors the TypeScript implementation in ui/src/lib/crypto.ts.

Pattern:
  NEXTAUTH_SECRET / ENCRYPTION_KEY
    └─ HKDF-SHA256 → KEK (Key Encryption Key, never stored)
          └─ Per secret: random DEK (Data Encryption Key)
                ├─ AES-256-GCM encrypt(plaintext, DEK)  → stored ciphertext
                └─ AES-256-GCM encrypt(DEK, KEK)        → stored wrapped_dek

Both sides must share the same master secret (NEXTAUTH_SECRET).
"""

import base64
import logging
import os
from dataclasses import asdict, dataclass
from typing import Any

logger = logging.getLogger(__name__)

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

CURRENT_KEY_VERSION = "v1"


@dataclass
class EnvelopeEncrypted:
    wrapped_dek: str  # base64
    dek_iv: str       # base64 (12 bytes)
    dek_tag: str      # base64 (16 bytes) — stored separately for compat with TS impl
    ciphertext: str   # base64
    data_iv: str      # base64 (12 bytes)
    data_tag: str     # base64 (16 bytes)
    key_version: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "EnvelopeEncrypted":
        return cls(
            wrapped_dek=d["wrapped_dek"],
            dek_iv=d["dek_iv"],
            dek_tag=d["dek_tag"],
            ciphertext=d["ciphertext"],
            data_iv=d["data_iv"],
            data_tag=d["data_tag"],
            key_version=d["key_version"],
        )


def _get_master_secret_from_mongodb() -> str | None:
    """Read the master key from MongoDB platform_config.master_key.

    Mirrors the UI's zero-config path (secret-manager.ts): when NEXTAUTH_SECRET
    is not set in the environment, the UI generates a key on first run and stores
    it in MongoDB. The DA backend must use the same key to decrypt secrets that
    the UI encrypted.
    """
    try:
        from dynamic_agents.services.mongo import get_mongo_service  # noqa: PLC0415
        mongo = get_mongo_service()
        if mongo._db is not None:
            doc = mongo._db["platform_config"].find_one({"_id": "master_key"})
            if doc and doc.get("value"):
                return str(doc["value"])
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not read master_key from MongoDB: %s", exc)
    return None


def _get_master_secret() -> str:
    """Return the master secret used for envelope encryption.

    Priority:
      1. NEXTAUTH_SECRET env var  (production / k8s env-managed key)
      2. ENCRYPTION_KEY env var   (explicit override)
      3. MongoDB platform_config.master_key  (zero-config / UI-generated key)

    The MongoDB fallback mirrors the UI's secret-manager.ts zero-config path:
    when no env key is set, the UI generates one on first run and persists it
    in MongoDB so it survives restarts.
    """
    secret = os.environ.get("NEXTAUTH_SECRET") or os.environ.get("ENCRYPTION_KEY")
    if not secret:
        secret = _get_master_secret_from_mongodb()
    if not secret:
        raise RuntimeError(
            "No master secret available. Set NEXTAUTH_SECRET or ENCRYPTION_KEY "
            "environment variable, or ensure the UI has initialized a key in MongoDB."
        )
    return secret


def _derive_kek(master_secret: str, key_version: str = CURRENT_KEY_VERSION) -> bytes:
    """Derive Key Encryption Key from master secret using HKDF-SHA256."""
    salt = f"caipe-kek-{key_version}".encode()
    info = b"key-encryption"
    hkdf = HKDF(algorithm=SHA256(), length=32, salt=salt, info=info)
    return hkdf.derive(master_secret.encode())


def decrypt_secret(encrypted: EnvelopeEncrypted, master_secret: str | None = None) -> str:
    """Decrypt an envelope-encrypted value."""
    if master_secret is None:
        master_secret = _get_master_secret()

    kek = _derive_kek(master_secret, encrypted.key_version)

    # Unwrap DEK
    dek_ct = base64.b64decode(encrypted.wrapped_dek)
    dek_tag = base64.b64decode(encrypted.dek_tag)
    dek_iv = base64.b64decode(encrypted.dek_iv)
    kek_cipher = AESGCM(kek)
    dek = kek_cipher.decrypt(dek_iv, dek_ct + dek_tag, None)

    # Decrypt plaintext
    data_ct = base64.b64decode(encrypted.ciphertext)
    data_tag = base64.b64decode(encrypted.data_tag)
    data_iv = base64.b64decode(encrypted.data_iv)
    data_cipher = AESGCM(dek)
    plaintext_bytes = data_cipher.decrypt(data_iv, data_ct + data_tag, None)

    return plaintext_bytes.decode()


def is_envelope_encrypted(value: Any) -> bool:
    """Return True if value looks like an EnvelopeEncrypted dict."""
    return (
        isinstance(value, dict)
        and "wrapped_dek" in value
        and "ciphertext" in value
        and "key_version" in value
    )


def decrypt_env_dict(env: dict[str, Any]) -> dict[str, str]:
    """Decrypt all envelope-encrypted values in an env dict. Returns plaintext dict."""
    result: dict[str, str] = {}
    for k, v in env.items():
        if is_envelope_encrypted(v):
            result[k] = decrypt_secret(EnvelopeEncrypted.from_dict(v))
        else:
            result[k] = str(v)
    return result


