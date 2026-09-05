/** Literal-token checks, not a linguistic score or a full ICU/template parser. */
// Explicit ECMAScript whitespace avoids PostgreSQL locale-dependent \s (NBSP,
// for example, is not classified identically by the two regex engines).
const tokenSpace =
  "[\u0009-\u000d \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]";
export const TRANSLATION_TOKEN_PATTERN = String.raw`\{\{${tokenSpace}*[A-Za-z_][A-Za-z_0-9.-]*${tokenSpace}*\}\}|\$?\{[A-Za-z_][A-Za-z_0-9.-]*\}|%%|%(?:[1-9][0-9]*\$)?[sdif]`;

export type VariableQuality = "mismatch" | "match" | "unchecked";
export type ObservedActivity = "recent" | "older" | "unknown";
export const OBSERVATION_WINDOW_DAYS = 30;

export function observationCutoff(now: Date) {
  return new Date(now.getTime() - OBSERVATION_WINDOW_DAYS * 86_400_000);
}

export function translationTokenCounts(text: string) {
  const counts = new Map<string, number>();
  for (const [token] of text.matchAll(
    new RegExp(TRANSLATION_TOKEN_PATTERN, "g"),
  )) {
    if (token !== "%%") counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function savedVariableQuality(
  original: string,
  translated: string,
  variables: readonly string[],
): VariableQuality {
  if (!variables.length) return "unchecked";
  const source = translationTokenCounts(original);
  const target = translationTokenCounts(translated);
  return variables.some(
    (token) => !source.has(token) || source.get(token) !== target.get(token),
  )
    ? "mismatch"
    : "match";
}
