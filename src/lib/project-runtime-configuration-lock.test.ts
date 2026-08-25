import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

import { isProjectRuntimeSerializationConflict } from "@/lib/project-runtime-configuration-lock";

test("classifies each Prisma P2010 serialization signal independently", () => {
  const postgresCodeOnly = new Prisma.PrismaClientKnownRequestError(
    "Raw query failed",
    {
      code: "P2010",
      clientVersion: "test",
      meta: {
        driverAdapterError: {
          cause: {
            kind: "DatabaseError",
            originalCode: "40001",
          },
        },
      },
    },
  );
  const adapterKindOnly = new Prisma.PrismaClientKnownRequestError(
    "Raw query failed",
    {
      code: "P2010",
      clientVersion: "test",
      meta: {
        driverAdapterError: {
          cause: {
            kind: "TransactionWriteConflict",
            originalCode: "unknown",
          },
        },
      },
    },
  );

  assert.equal(isProjectRuntimeSerializationConflict(postgresCodeOnly), true);
  assert.equal(isProjectRuntimeSerializationConflict(adapterKindOnly), true);
});

test("classifies Prisma P2034 directly and rejects unrelated raw errors", () => {
  const transactionConflict = new Prisma.PrismaClientKnownRequestError(
    "Transaction conflict",
    { code: "P2034", clientVersion: "test" },
  );
  const unrelated = new Prisma.PrismaClientKnownRequestError(
    "Raw query failed",
    {
      code: "P2010",
      clientVersion: "test",
      meta: {
        driverAdapterError: {
          cause: { kind: "DatabaseConstraint", originalCode: "23505" },
        },
      },
    },
  );

  assert.equal(isProjectRuntimeSerializationConflict(transactionConflict), true);
  assert.equal(isProjectRuntimeSerializationConflict(unrelated), false);
});
