import assert from "node:assert/strict";
import test from "node:test";

import { deletePasskeyForUser } from "@/lib/passkey-management";

test("deletes a passkey only when it belongs to the signed-in user", async () => {
  const calls: unknown[] = [];
  const deleted = await deletePasskeyForUser(
    {
      deleteMany: async (args) => {
        calls.push(args);
        return { count: 1 };
      },
    },
    "user_123",
    "credential_456"
  );

  assert.equal(deleted, true);
  assert.deepEqual(calls, [
    {
      where: {
        credentialID: "credential_456",
        userId: "user_123",
      },
    },
  ]);
});

test("does not report another user's passkey as deleted", async () => {
  const calls: unknown[] = [];
  const deleted = await deletePasskeyForUser(
    {
      deleteMany: async (args) => {
        calls.push(args);
        return { count: 0 };
      },
    },
    "user_other",
    "credential_456"
  );

  assert.equal(deleted, false);
  assert.deepEqual(calls, [
    {
      where: {
        credentialID: "credential_456",
        userId: "user_other",
      },
    },
  ]);
});

test("rejects malformed identifiers before touching persistence", async () => {
  let calls = 0;

  await assert.rejects(
    deletePasskeyForUser(
      {
        deleteMany: async () => {
          calls += 1;
          return { count: 0 };
        },
      },
      "",
      "credential_456"
    ),
    /user id/i
  );
  await assert.rejects(
    deletePasskeyForUser(
      {
        deleteMany: async () => {
          calls += 1;
          return { count: 0 };
        },
      },
      "user_123",
      ""
    ),
    /credential id/i
  );
  await assert.rejects(
    deletePasskeyForUser(
      {
        deleteMany: async () => {
          calls += 1;
          return { count: 0 };
        },
      },
      "user_123",
      "x".repeat(2049)
    ),
    /credential id/i
  );
  assert.equal(calls, 0);
});
