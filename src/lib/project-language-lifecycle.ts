import { createHash } from "node:crypto";

/** Canonical storage and path form: lowercase BCP 47 language/script/region tags. */
export function normalizeTargetLocale(input: string): string | null {
  const value = input.trim().replaceAll("_", "-");
  if (!/^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?$/i.test(value)) {
    return null;
  }
  try {
    return new Intl.Locale(value).toString().toLowerCase();
  } catch {
    return null;
  }
}

export function isCanonicalTargetLocale(input: string): boolean {
  return /^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?$/.test(input);
}

export function targetLocaleFallbacks(locale: string): string[] {
  const normalized = normalizeTargetLocale(locale);
  if (!normalized) return [];
  const subtags = normalized.split("-");
  return subtags.map((_, index) => subtags.slice(0, subtags.length - index).join("-"));
}

export interface LanguageRemovalSnapshot {
  langCode: string;
  projectVersion: string;
  translations: number;
  urls: number;
  slugs: number;
  usageWords: number;
  [key: string]: string | number | boolean | string[] | null | undefined;
}

export function languageRemovalFingerprint(snapshot: LanguageRemovalSnapshot): string {
  const canonical = Object.entries(snapshot)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
