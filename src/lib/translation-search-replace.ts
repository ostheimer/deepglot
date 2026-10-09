import { createHash } from "node:crypto";
import { allPlaceholderQuality, translationTokenCounts } from "./translation-quality";

export const MAX_WORKSPACE_REPLACE_ITEMS = 100;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/g;
const TAG_PATTERN = /<\/?[A-Za-z][^>]*>/g;
const ENTITY_PATTERN = /&(?:#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function counts(values: readonly string[]) {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function sameCounts(a: Map<string, number>, b: Map<string, number>) {
  return a.size === b.size && [...a].every(([key, count]) => b.get(key) === count);
}

function occurrences(text: string, term: string) {
  return term ? text.split(term).length - 1 : 0;
}

export function assertProtectedWorkspaceText(original: string, before: string, after: string,
  glossaryTerms: readonly string[]) {
  if (
    !sameCounts(translationTokenCounts(before), translationTokenCounts(after)) ||
    allPlaceholderQuality(original, after) === "mismatch" ||
    !sameCounts(counts(before.match(URL_PATTERN) ?? []), counts(after.match(URL_PATTERN) ?? [])) ||
    !sameCounts(counts(before.match(TAG_PATTERN) ?? []), counts(after.match(TAG_PATTERN) ?? [])) ||
    !sameCounts(counts(before.match(ENTITY_PATTERN) ?? []), counts(after.match(ENTITY_PATTERN) ?? [])) ||
    !sameCounts(counts(before.match(EMAIL_PATTERN) ?? []), counts(after.match(EMAIL_PATTERN) ?? [])) ||
    glossaryTerms.some((term) => occurrences(before, term) !== occurrences(after, term))
  ) throw new Error("Change affects protected placeholders, URLs, HTML or glossary terms.");
}

/** A literal edit may change prose but never structural tokens or protected terms. */
export function planWorkspaceReplacement(input: {
  originalText: string;
  translatedText: string;
  find: string;
  replace: string;
  glossaryTerms: readonly string[];
}) {
  if (!input.find || input.find.length > 200 || input.replace.length > 200)
    throw new Error("Invalid search or replacement text.");
  const after = input.translatedText.split(input.find).join(input.replace);
  if (after === input.translatedText) return null;
  assertProtectedWorkspaceText(input.originalText, input.translatedText, after, input.glossaryTerms);
  return after;
}

export function replacementFingerprint(input: {
  projectId: string;
  userId: string;
  find: string;
  replace: string;
  includeReviewed?: boolean;
  rows: readonly { id: string; updatedAt: string; before: string; after: string }[];
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
