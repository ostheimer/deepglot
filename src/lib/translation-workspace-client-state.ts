export type TranslationWorkspaceEditDraft = {
  id: string;
  text: string;
  expectedUpdatedAt: string;
};

export function canEditWorkspaceTranslation({
  canManage,
  currentMemberId,
  assignedToId,
  langTo,
  activeLanguageCodes,
}: {
  canManage: boolean;
  currentMemberId: string | null;
  assignedToId: string | null;
  langTo: string;
  activeLanguageCodes: readonly string[];
}) {
  const normalizedLanguage = langTo.trim().toLowerCase();
  const languageIsActive = activeLanguageCodes.some(
    (languageCode) => languageCode.trim().toLowerCase() === normalizedLanguage,
  );

  return (
    languageIsActive &&
    (canManage ||
      (currentMemberId !== null && currentMemberId === assignedToId))
  );
}

export function beginTranslationWorkspaceEdit({
  id,
  translatedText,
  updatedAt,
}: {
  id: string;
  translatedText: string;
  updatedAt: string;
}): TranslationWorkspaceEditDraft {
  return {
    id,
    text: translatedText,
    expectedUpdatedAt: updatedAt,
  };
}

export function completeTranslationWorkspaceEdit(
  draft: TranslationWorkspaceEditDraft | null,
  result: {
    translationId: string;
    mutation: "content" | "workflow";
  },
) {
  if (draft?.id === result.translationId && result.mutation === "content") {
    return null;
  }

  return draft;
}

export type TranslationWorkspaceQuery = {
  label?: string;
  variables?: string;
  source?: string;
  mode?: string;
  context?: string;
  urlPath?: string;
  sort?: string;
  status: string;
  langTo: string;
  assignee: string;
  submittedQuery: string;
  page: number;
};

export function translationWorkspaceQueryKey(query: TranslationWorkspaceQuery) {
  return JSON.stringify([
    query.label ?? "",
    query.variables ?? "",
    query.source ?? "",
    query.mode ?? "",
    query.context ?? "",
    query.urlPath ?? "",
    query.sort ?? "",
    query.status,
    query.langTo,
    query.assignee,
    query.submittedQuery,
    query.page,
  ]);
}

export function deletionResponseMatchesWorkspaceQuery(
  requestQueryKey: string,
  currentQueryKey: string,
) {
  return requestQueryKey === currentQueryKey;
}
