import assert from "node:assert/strict";
import test from "node:test";

import type { User } from "@prisma/client";

import { toAuthUser } from "@/lib/auth-user";

test("reduces a Prisma user to the Auth.js-safe user payload", () => {
  const user: User = {
    id: "user_123",
    email: "preview@deepglot.local",
    name: "Deepglot Test",
    image: null,
    emailVerified: null,
    password: "hashed-password",
    createdAt: new Date("2026-03-09T00:00:00.000Z"),
    updatedAt: new Date("2026-03-09T00:00:00.000Z"),
  };

  assert.deepEqual(toAuthUser(user), {
    id: "user_123",
    email: "preview@deepglot.local",
    name: "Deepglot Test",
    image: null,
  });
});
