import assert from "node:assert/strict";
import test from "node:test";

import {
  beginTranslationWorkspaceEdit,
  canEditWorkspaceTranslation,
  completeTranslationWorkspaceEdit,
  deletionResponseMatchesWorkspaceQuery,
  translationWorkspaceQueryKey,
} from "@/lib/translation-workspace-client-state";

test("every advanced filter changes the response identity", () => {
  const base = {
    status: "",
    langTo: "",
    assignee: "",
    submittedQuery: "",
    page: 1,
  };
  const key = translationWorkspaceQueryKey(base);
  for (const filter of ["source", "mode", "context", "urlPath", "sort"]) {
    assert.notEqual(
      translationWorkspaceQueryKey({ ...base, [filter]: "changed" }),
      key,
      filter,
    );
  }
});

test("inactive target-language segments never expose workspace editing", () => {
  assert.equal(
    canEditWorkspaceTranslation({
      canManage: true,
      currentMemberId: null,
      assignedToId: null,
      langTo: "it",
      activeLanguageCodes: ["en", "fr"],
    }),
    false,
  );
  assert.equal(
    canEditWorkspaceTranslation({
      canManage: false,
      currentMemberId: "member-en",
      assignedToId: "member-en",
      langTo: "en",
      activeLanguageCodes: ["en", "fr"],
    }),
    true,
  );
});

test("an edit draft keeps the concurrency token from the moment editing begins", () => {
  const draft = beginTranslationWorkspaceEdit({
    id: "translation-a",
    translatedText: "Original draft",
    updatedAt: "2026-09-05T01:00:00.000Z",
  });

  assert.deepEqual(draft, {
    id: "translation-a",
    text: "Original draft",
    expectedUpdatedAt: "2026-09-05T01:00:00.000Z",
  });
  assert.equal(draft.expectedUpdatedAt, "2026-09-05T01:00:00.000Z");
});

test("only saving content for the open segment closes its editor", () => {
  const draft = beginTranslationWorkspaceEdit({
    id: "translation-a",
    translatedText: "Unsaved draft",
    updatedAt: "2026-09-05T01:00:00.000Z",
  });

  assert.equal(
    completeTranslationWorkspaceEdit(draft, {
      translationId: "translation-b",
      mutation: "workflow",
    }),
    draft,
  );
  assert.equal(
    completeTranslationWorkspaceEdit(draft, {
      translationId: "translation-a",
      mutation: "workflow",
    }),
    draft,
  );
  assert.equal(
    completeTranslationWorkspaceEdit(draft, {
      translationId: "translation-a",
      mutation: "content",
    }),
    null,
  );
});

test("a deletion response cannot reconcile data captured under stale filters", () => {
  const requestQueryKey = translationWorkspaceQueryKey({
    status: "machine",
    langTo: "en",
    assignee: "",
    submittedQuery: "old",
    page: 1,
  });
  const currentQueryKey = translationWorkspaceQueryKey({
    status: "approved",
    langTo: "fr",
    assignee: "member-fr",
    submittedQuery: "new",
    page: 1,
  });

  assert.equal(
    deletionResponseMatchesWorkspaceQuery(requestQueryKey, currentQueryKey),
    false,
  );
  assert.equal(
    deletionResponseMatchesWorkspaceQuery(requestQueryKey, requestQueryKey),
    true,
  );
});

test("metadata filters participate in query identity", () => {
  const base = {
    status: "",
    langTo: "en",
    assignee: "",
    submittedQuery: "",
    page: 1,
  };
  for (const filters of [
    { label: "qa" },
    { variables: "saved" },
    { variables: "none" },
    { quality: "mismatch" },
    { quality: "match" },
    { quality: "unchecked" },
    { activity: "recent" },
    { activity: "older" },
    { activity: "unknown" },
  ]) {
    assert.notEqual(
      translationWorkspaceQueryKey(base),
      translationWorkspaceQueryKey({ ...base, ...filters }),
    );
  }
});
