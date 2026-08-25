import Passkey from "next-auth/providers/passkey";
import type { GetUserInfo } from "next-auth/providers/webauthn";

const getExistingUserInfo: GetUserInfo = async (options, request) => {
  const adapter = options.adapter;
  if (!adapter) {
    throw new Error("Passkeys require a database adapter.");
  }

  const email = (
    request.method === "POST" ? request.body?.email : request.query?.email
  ) as unknown;
  if (typeof email !== "string" || !email.trim()) {
    return null;
  }

  const user = await adapter.getUserByEmail(email);

  // Passkeys may only be added from an authenticated account settings
  // session. Returning null for unknown addresses prevents Auth.js from
  // turning the public sign-in endpoint into an alternate signup route.
  return user ? { user, exists: true } : null;
};

export function createPasskeyProvider() {
  return Passkey({
    enableConditionalUI: false,
    simpleWebAuthnBrowserVersion: false,
    getUserInfo: getExistingUserInfo,
  });
}
