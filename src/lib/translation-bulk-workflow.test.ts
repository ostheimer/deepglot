import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBulkWorkflowAction,
  bulkWorkflowPatch,
} from "./translation-bulk-workflow";
import { TranslationWorkflowError } from "./translation-workflow";

test("bulk actions map to the existing workflow state machine", () => {
  assert.deepEqual(bulkWorkflowPatch({ kind: "assign", assignedToId: "member" }), { assignedToId: "member" });
  assert.deepEqual(bulkWorkflowPatch({ kind: "unassign" }), { assignedToId: null });
  assert.deepEqual(bulkWorkflowPatch({ kind: "submit" }), { status: "IN_REVIEW" });
  assert.deepEqual(bulkWorkflowPatch({ kind: "approve" }), { status: "APPROVED" });
  assert.deepEqual(bulkWorkflowPatch({ kind: "return" }), { status: "ASSIGNED" });
  assert.deepEqual(bulkWorkflowPatch({ kind: "reopen" }), { status: "ASSIGNED" });
});

test("bulk review requires the correct starting state", () => {
  assert.doesNotThrow(() => assertBulkWorkflowAction({ kind: "submit" }, "ASSIGNED"));
  assert.doesNotThrow(() => assertBulkWorkflowAction({ kind: "approve" }, "IN_REVIEW"));
  for (const [action, status] of [
    [{ kind: "submit" }, "MACHINE"],
    [{ kind: "approve" }, "APPROVED"],
    [{ kind: "return" }, "ASSIGNED"],
    [{ kind: "reopen" }, "IN_REVIEW"],
  ] as const) {
    assert.throws(() => assertBulkWorkflowAction(action, status),
      (error) => error instanceof TranslationWorkflowError && error.code === "INVALID_TRANSITION");
  }
});
