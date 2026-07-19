import assert from "node:assert/strict";
import test from "node:test";

import {
  TranslationWorkflowError,
  planTranslationWorkflowUpdate,
  resetTranslationWorkflowAfterContentEdit,
  workflowResetFieldsIfTranslatedTextChanged,
  resolveTranslationWorkflowLanguage,
  type TranslationWorkflowActor,
} from "@/lib/translation-workflow";

const manager: TranslationWorkflowActor = {
  canManage: true,
  projectMemberId: null,
  langCode: null,
};

const englishTranslator: TranslationWorkflowActor = {
  canManage: false,
  projectMemberId: "member-en",
  langCode: "en",
};

function expectWorkflowError(
  run: () => unknown,
  code: TranslationWorkflowError["code"],
) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof TranslationWorkflowError);
    assert.equal(error.code, code);
    return true;
  });
}

test("manager assignment starts the review workflow and enforces project/language scope", () => {
  const assigned = planTranslationWorkflowUpdate({
    projectId: "project-a",
    current: { status: "MACHINE", assignedToId: null, langTo: "en" },
    patch: { assignedToId: "member-en" },
    actor: manager,
    assignee: {
      id: "member-en",
      projectId: "project-a",
      langCode: "en",
    },
  });

  assert.deepEqual(assigned, {
    status: "ASSIGNED",
    assignedToId: "member-en",
  });

  expectWorkflowError(
    () =>
      planTranslationWorkflowUpdate({
        projectId: "project-a",
        current: { status: "MACHINE", assignedToId: null, langTo: "en" },
        patch: { assignedToId: "foreign-member" },
        actor: manager,
        assignee: {
          id: "foreign-member",
          projectId: "project-b",
          langCode: "en",
        },
      }),
    "INVALID_ASSIGNEE",
  );

  expectWorkflowError(
    () =>
      planTranslationWorkflowUpdate({
        projectId: "project-a",
        current: { status: "MACHINE", assignedToId: null, langTo: "fr" },
        patch: { assignedToId: "member-en" },
        actor: manager,
        assignee: {
          id: "member-en",
          projectId: "project-a",
          langCode: "en",
        },
      }),
    "INVALID_ASSIGNEE",
  );
});

test("only the assigned translator may submit a segment for review", () => {
  assert.deepEqual(
    planTranslationWorkflowUpdate({
      projectId: "project-a",
      current: {
        status: "ASSIGNED",
        assignedToId: "member-en",
        langTo: "en",
      },
      patch: { status: "IN_REVIEW" },
      actor: englishTranslator,
    }),
    { status: "IN_REVIEW", assignedToId: "member-en" },
  );

  expectWorkflowError(
    () =>
      planTranslationWorkflowUpdate({
        projectId: "project-a",
        current: {
          status: "ASSIGNED",
          assignedToId: "someone-else",
          langTo: "en",
        },
        patch: { status: "IN_REVIEW" },
        actor: englishTranslator,
      }),
    "FORBIDDEN",
  );

  expectWorkflowError(
    () =>
      planTranslationWorkflowUpdate({
        projectId: "project-a",
        current: {
          status: "IN_REVIEW",
          assignedToId: "member-en",
          langTo: "en",
        },
        patch: { status: "APPROVED" },
        actor: englishTranslator,
      }),
    "FORBIDDEN",
  );
});

test("the state machine rejects skipped transitions and preserves a reviewer on approval", () => {
  expectWorkflowError(
    () =>
      planTranslationWorkflowUpdate({
        projectId: "project-a",
        current: { status: "MACHINE", assignedToId: null, langTo: "en" },
        patch: { status: "APPROVED" },
        actor: manager,
      }),
    "INVALID_TRANSITION",
  );

  assert.deepEqual(
    planTranslationWorkflowUpdate({
      projectId: "project-a",
      current: {
        status: "IN_REVIEW",
        assignedToId: "member-en",
        langTo: "en",
      },
      patch: { status: "APPROVED" },
      actor: manager,
    }),
    { status: "APPROVED", assignedToId: "member-en" },
  );

  assert.deepEqual(
    planTranslationWorkflowUpdate({
      projectId: "project-a",
      current: {
        status: "APPROVED",
        assignedToId: "member-en",
        langTo: "en",
      },
      patch: { status: "ASSIGNED" },
      actor: manager,
    }),
    { status: "ASSIGNED", assignedToId: "member-en" },
  );
});

test("unassigning resets a segment to machine and translators cannot assign", () => {
  assert.deepEqual(
    planTranslationWorkflowUpdate({
      projectId: "project-a",
      current: {
        status: "ASSIGNED",
        assignedToId: "member-en",
        langTo: "en",
      },
      patch: { assignedToId: null },
      actor: manager,
    }),
    { status: "MACHINE", assignedToId: null },
  );

  expectWorkflowError(
    () =>
      planTranslationWorkflowUpdate({
        projectId: "project-a",
        current: { status: "MACHINE", assignedToId: null, langTo: "en" },
        patch: { assignedToId: "member-en" },
        actor: englishTranslator,
        assignee: {
          id: "member-en",
          projectId: "project-a",
          langCode: "en",
        },
      }),
    "FORBIDDEN",
  );
});

test("language filters are forced to the translator's assigned language", () => {
  assert.equal(resolveTranslationWorkflowLanguage(manager, undefined), undefined);
  assert.equal(
    resolveTranslationWorkflowLanguage(englishTranslator, undefined),
    "en",
  );
  assert.equal(
    resolveTranslationWorkflowLanguage(englishTranslator, "EN"),
    "en",
  );
  expectWorkflowError(
    () => resolveTranslationWorkflowLanguage(englishTranslator, "fr"),
    "FORBIDDEN",
  );
});

test("content edits invalidate approval while preserving a valid assignment", () => {
  assert.deepEqual(
    resetTranslationWorkflowAfterContentEdit({
      workflowStatus: "APPROVED",
      assignedToId: "member-en",
    }),
    { workflowStatus: "ASSIGNED" },
  );
  assert.deepEqual(
    resetTranslationWorkflowAfterContentEdit({
      workflowStatus: "APPROVED",
      assignedToId: null,
    }),
    { workflowStatus: "MACHINE", assignedToId: null },
  );
  assert.deepEqual(
    resetTranslationWorkflowAfterContentEdit({
      workflowStatus: "IN_REVIEW",
      assignedToId: "member-en",
    }),
    { workflowStatus: "ASSIGNED" },
  );
});

test("unchanged translated text keeps workflow approval on import-style writes", () => {
  const approved = {
    workflowStatus: "APPROVED" as const,
    assignedToId: "member-en",
    translatedText: "Hello",
  };

  assert.deepEqual(
    workflowResetFieldsIfTranslatedTextChanged(approved, "Hello"),
    {},
  );
  assert.deepEqual(
    workflowResetFieldsIfTranslatedTextChanged(approved, "Hi"),
    { workflowStatus: "ASSIGNED" },
  );
});
