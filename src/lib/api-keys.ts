import crypto from "crypto";
import { db } from "@/lib/db";

const KEY_PREFIX = "dg_live_";

/**
 * Generates a new API key, stores its hash in the DB.
 * Returns the raw key (shown once to the user) and the DB record.
 */
export async function generateApiKey({
  projectId,
  name,
  expiresAt,
}: {
  projectId: string;
  name: string;
  expiresAt?: Date;
}) {
  const rawKey = KEY_PREFIX + crypto.randomBytes(32).toString("hex");
  const hashedKey = hashApiKey(rawKey);
  const keyPrefix = rawKey.substring(0, 16); // display prefix

  const apiKey = await db.apiKey.create({
    data: {
      projectId,
      name,
      key: hashedKey,
      keyPrefix,
      expiresAt,
    },
  });

  return { rawKey, apiKey };
}

/**
 * Validates an API key. Returns the associated project and organization if valid.
 */
export async function validateApiKey(rawKey: string) {
  const hashedKey = hashApiKey(rawKey);

  const apiKey = await db.apiKey.findUnique({
    where: { key: hashedKey },
    include: {
      project: {
        include: {
          organization: {
            include: { subscription: true },
          },
          languages: true,
          settings: true,
        },
      },
    },
  });

  if (!apiKey || !apiKey.isActive) return null;
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

  // Update last used timestamp (fire and forget)
  db.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return apiKey;
}

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}
