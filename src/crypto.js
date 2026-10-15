// Client connector credentials (GoHighLevel keys, Shopify tokens, OAuth refresh
// tokens) are encrypted here before they are stored, so the database only ever
// holds ciphertext. The key lives in the app environment, never in the database.
//
// This is deliberately fail-closed: with no key configured, storing credentials
// raises instead of silently writing plaintext.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

export function createCipher(keyHex) {
  if (!keyHex) {
    return {
      enabled: false,
      encrypt() {
        throw new Error("CREDENTIALS_KEY is not set, so credentials cannot be stored.");
      },
      decrypt() {
        throw new Error("CREDENTIALS_KEY is not set, so stored credentials cannot be read.");
      },
    };
  }

  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("CREDENTIALS_KEY must be 64 hex characters (32 bytes).");
  }

  return {
    enabled: true,

    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv(ALGO, key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return {
        v: 1,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: body.toString("base64"),
      };
    },

    decrypt(blob) {
      if (!blob || typeof blob !== "object" || !blob.data) return {};
      const decipher = createDecipheriv(ALGO, key, Buffer.from(blob.iv, "base64"));
      decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(blob.data, "base64")),
        decipher.final(),
      ]).toString("utf8");
      return JSON.parse(plain);
    },
  };
}
