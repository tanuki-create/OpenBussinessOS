"use strict";

const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";
const KEY_SALT = "open-business-os-secret-encryption";

function secretMaterial() {
  return (
    process.env.OPEN_BUSINESS_OS_ENCRYPTION_KEY ||
    process.env.OPEN_BUSINESS_OS_SECRET ||
    "open-business-os-local-dev-secret"
  );
}

function encryptionKey() {
  return crypto.scryptSync(secretMaterial(), KEY_SALT, 32);
}

function encryptSecret(plainText) {
  if (typeof plainText !== "string" || plainText.length === 0) {
    throw new TypeError("Secret must be a non-empty string.");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

function decryptSecret(encryptedSecret) {
  if (typeof encryptedSecret !== "string") {
    throw new TypeError("Encrypted secret must be a string.");
  }

  const [version, iv, tag, encrypted] = encryptedSecret.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported encrypted secret format.");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function keyHint(secret) {
  if (typeof secret !== "string" || secret.length === 0) return null;
  if (secret.length <= 8) return `${secret.slice(0, 1)}...${secret.slice(-1)}`;
  return `${secret.slice(0, 3)}...${secret.slice(-4)}`;
}

module.exports = {
  decryptSecret,
  encryptSecret,
  keyHint
};
