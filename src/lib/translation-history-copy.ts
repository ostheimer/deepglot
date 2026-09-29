import type { SiteLocale } from "./site-locale";
import { uiText } from "./static-copy";

export const HISTORY_KEYS = ["title", "scope", "empty", "unknown", "before", "after", "error", "loading", "retry", "more"] as const;
type HistoryKey = (typeof HISTORY_KEYS)[number];
const english: Record<HistoryKey, string> = {
  "title": "Change history",
  "scope": "New workspace edits only. Earlier edits and other editors are not included.",
  "empty": "No recorded workspace edits.",
  "unknown": "Unknown editor",
  "before": "Before",
  "after": "After",
  "error": "History could not be loaded.",
  "loading": "Loading…",
  "retry": "Retry",
  "more": "Load older changes"
};
export function historyText(locale: SiteLocale, key: HistoryKey): string {
  return uiText(locale, english[key]);
}
