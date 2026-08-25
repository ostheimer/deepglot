import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  auth: new URL("./auth.ts", import.meta.url),
  login: new URL("../components/auth/login-card.tsx", import.meta.url),
  schema: new URL("../../prisma/schema.prisma", import.meta.url),
  settings: new URL(
    "../components/einstellungen/passkey-settings.tsx",
    import.meta.url
  ),
};

test("wires Auth.js, Prisma, login, enrollment, and revocation together", async () => {
  const [auth, login, schema, settings] = await Promise.all(
    Object.values(files).map((file) => readFile(file, "utf8"))
  );

  assert.match(auth, /createPasskeyProvider\(\)/);
  assert.match(auth, /enableWebAuthn:\s*true/);

  assert.match(schema, /model Authenticator\s*\{/);
  assert.match(schema, /credentialID\s+String\s+@unique/);
  assert.match(schema, /userId\s+String/);
  assert.match(schema, /onDelete:\s*Cascade/);

  assert.match(login, /next-auth\/webauthn/);
  assert.match(login, /action:\s*["']authenticate["']/);

  assert.match(settings, /action:\s*["']register["']/);
  assert.match(settings, /deletePasskeyAction/);
  assert.match(settings, /Passkey hinzufügen/);
});

test("documents the passkey schema, origin, experimental, and privacy rollout gates", async () => {
  const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");

  assert.match(readme, /prisma db push[^\n]*Authenticator/);
  assert.match(readme, /WebAuthn requires HTTPS[^\n]*relying-party hostname/);
  assert.match(readme, /WebAuthn implementation as experimental/);
  assert.match(readme, /review the approved privacy notice before production rollout/);
  assert.match(readme, /private keys and biometric data are not stored/);
});
