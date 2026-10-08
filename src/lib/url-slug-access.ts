import { canAccessProjectLanguage, type ProjectAccessContext } from "@/lib/project-access-policy";

/** A language-bound translator must not read another language's slug rows. */
export function selectReadableSlugLanguages<T extends { langCode: string; isActive: boolean }>(
  access: ProjectAccessContext,
  languages: T[],
): T[] {
  return languages.filter((language) =>
    language.isActive && canAccessProjectLanguage(access, language.langCode),
  );
}
