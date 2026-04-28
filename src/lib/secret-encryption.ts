import crypto from "crypto";

const ENCRYPTION_PREFIX = "v1";
const IV_LENGTH = 12;

function toBase64Url(buffer: Buffer) {
  return buffer.toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

export function getSecretEncryptionKey(
  env: Record<string, string | undefined> = process.env
) {
  const raw =
    env.DEEPGLOT_SECRET_ENCRYPTION_KEY?.trim() ||
    env.AUTH_SECRET?.trim();

  if (!raw) {
    throw new Error(
      "No secret encryption key configured. Set DEEPGLOT_SECRET_ENCRYPTION_KEY or AUTH_SECRET."
    );
  }

  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(
  value: string,
  env: Record<string, string | undefined> = process.env
) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSecretEncryptionKey(env), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    toBase64Url(iv),
    toBase64Url(tag),
    toBase64Url(ciphertext),
  ].join(":");
}

export function decryptSecret(
  value: string,
  env: Record<string, string | undefined> = process.env
) {
  const [prefix, ivValue, tagValue, ciphertextValue] = value.split(":");

  if (prefix !== ENCRYPTION_PREFIX || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Unsupported encrypted secret format.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getSecretEncryptionKey(env),
    fromBase64Url(ivValue)
  );
  decipher.setAuthTag(fromBase64Url(tagValue));

  return Buffer.concat([
    decipher.update(fromBase64Url(ciphertextValue)),
    decipher.final(),
  ]).toString("utf8");
}
