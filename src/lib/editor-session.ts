import crypto from "crypto";

export type EditorSessionClaims = {
  projectId: string;
  domain: string;
  exp: number;
  iat: number;
  nonce: string;
};

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  return Buffer.from(normalized, "base64").toString("utf8");
}

export function getEditorSessionSecret(
  env: Record<string, string | undefined> = process.env
) {
  const configured =
    env.DEEPGLOT_EDITOR_SECRET?.trim() ||
    env.AUTH_SECRET?.trim() ||
    env.NEXTAUTH_SECRET?.trim();

  if (configured) {
    return configured;
  }

  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    return "deepglot-editor-local-development-secret";
  }

  throw new Error(
    "No editor session secret configured. Set DEEPGLOT_EDITOR_SECRET or AUTH_SECRET."
  );
}

export function createEditorSessionToken(
  {
    projectId,
    domain,
    ttlSeconds = 900,
  }: {
    projectId: string;
    domain: string;
    ttlSeconds?: number;
  },
  secret = getEditorSessionSecret()
) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: EditorSessionClaims = {
    projectId,
    domain,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    nonce: crypto.randomBytes(8).toString("hex"),
  };

  const payload = encodeBase64Url(JSON.stringify(claims));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

export function verifyEditorSessionToken(
  token: string,
  secret = getEditorSessionSecret(),
  now = Date.now()
) {
  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  const claims = JSON.parse(decodeBase64Url(payload)) as EditorSessionClaims;

  if (claims.exp * 1000 <= now) {
    return null;
  }

  return claims;
}
