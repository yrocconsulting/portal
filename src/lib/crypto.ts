import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts client passwords with AES-256-GCM. The key comes from CREDENTIALS_KEY (server environment
 * only), so a copy of the database alone can't reveal any password.
 */
function key(): Buffer {
  const raw = process.env.CREDENTIALS_KEY;
  if (!raw || raw.length < 32) throw new Error("CREDENTIALS_KEY is not set (needs a long random value).");
  return createHash("sha256").update(raw).digest();
}

export function credentialsReady(): boolean {
  return !!process.env.CREDENTIALS_KEY && process.env.CREDENTIALS_KEY.length >= 32;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(enc: string): string {
  const [v, iv, tag, ct] = enc.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unreadable password record.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}
