import assert from "node:assert/strict";
import test from "node:test";

import { createPasskeyProvider } from "@/lib/passkey-provider";

const existingUser = {
  id: "user_123",
  email: "ada@example.com",
  name: "Ada Lovelace",
  image: null,
  emailVerified: null,
};

test("configures discoverable, user-verified passkeys without conditional UI", () => {
  const provider = createPasskeyProvider();

  assert.equal(provider.id, "passkey");
  assert.equal(provider.type, "webauthn");
  assert.equal(provider.enableConditionalUI, false);
  assert.equal(provider.simpleWebAuthnBrowserVersion, false);
  assert.equal(provider.authenticationOptions?.userVerification, "required");
  assert.equal(
    provider.registrationOptions.authenticatorSelection?.residentKey,
    "required"
  );
  assert.equal(
    provider.registrationOptions.authenticatorSelection?.userVerification,
    "required"
  );
});

test("allows an existing account to authenticate by email", async () => {
  const lookedUpEmails: string[] = [];
  const provider = createPasskeyProvider();
  const result = await provider.getUserInfo(
    {
      adapter: {
        getUserByEmail: async (email: string) => {
          lookedUpEmails.push(email);
          return email === existingUser.email ? existingUser : null;
        },
      },
    } as never,
    {
      method: "GET",
      query: { email: existingUser.email },
    } as never
  );

  assert.deepEqual(lookedUpEmails, [existingUser.email]);
  assert.deepEqual(result, { user: existingUser, exists: true });
});

test("rejects unauthenticated explicit passkey registration before account lookup", async () => {
  const lookedUpEmails: string[] = [];
  const provider = createPasskeyProvider();
  const result = await provider.getUserInfo(
    {
      adapter: {
        getUserByEmail: async (email: string) => {
          lookedUpEmails.push(email);
          return existingUser;
        },
      },
    } as never,
    {
      method: "GET",
      query: { action: "register", email: existingUser.email },
    } as never
  );

  assert.equal(result, null);
  assert.deepEqual(lookedUpEmails, []);
});

test("never turns an unknown email into an unauthenticated passkey signup", async () => {
  const provider = createPasskeyProvider();
  const result = await provider.getUserInfo(
    {
      adapter: {
        getUserByEmail: async () => null,
      },
    } as never,
    {
      method: "POST",
      body: { email: "new@example.com" },
    } as never
  );

  assert.equal(result, null);
});

test("requires a usable adapter and email for account lookup", async () => {
  const provider = createPasskeyProvider();

  await assert.rejects(
    provider.getUserInfo({ adapter: undefined } as never, {
      method: "GET",
      query: { email: existingUser.email },
    } as never),
    /database adapter/i
  );
  assert.equal(
    await provider.getUserInfo(
      {
        adapter: {
          getUserByEmail: async () => existingUser,
        },
      } as never,
      { method: "GET", query: {} } as never
    ),
    null
  );
});
