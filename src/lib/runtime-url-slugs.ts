export const MAX_RUNTIME_URL_SLUGS = 10_000;

export type RuntimeUrlSlugRow = {
  originalSlug: string;
  translatedSlug: string | null;
  langTo: string;
};

export type RuntimeUrlSlug = {
  originalSlug: string;
  translatedSlug: string;
  langTo: string;
};

function normalizeSegmentForCollision(value: string) {
  const trimmed = value.trim();
  try {
    return decodeURIComponent(trimmed).toLocaleLowerCase("und");
  } catch {
    return trimmed.toLocaleLowerCase("und");
  }
}

/**
 * Builds the public plugin payload from every UrlSlug row, including rows
 * without a translation. Those untranslated rows reserve their original path
 * segment so a translated slug cannot silently shadow a real source URL.
 */
export function buildRuntimeUrlSlugs(rows: RuntimeUrlSlugRow[]): RuntimeUrlSlug[] {
  const originalCounts = new Map<string, number>();
  const translatedOwners = new Map<string, Set<string>>();

  for (const row of rows) {
    const language = row.langTo.trim().toLowerCase();
    const original = normalizeSegmentForCollision(row.originalSlug);
    if (!language || !original) {
      continue;
    }

    const originalKey = `${language}\0${original}`;
    originalCounts.set(originalKey, (originalCounts.get(originalKey) ?? 0) + 1);

    const translated = row.translatedSlug?.trim();
    if (!translated) {
      continue;
    }

    const translatedKey = `${language}\0${normalizeSegmentForCollision(translated)}`;
    const owners = translatedOwners.get(translatedKey) ?? new Set<string>();
    owners.add(original);
    translatedOwners.set(translatedKey, owners);
  }

  return rows.flatMap((row) => {
    const language = row.langTo.trim().toLowerCase();
    const original = normalizeSegmentForCollision(row.originalSlug);
    const translatedSlug = row.translatedSlug?.trim();
    if (!language || !original || !translatedSlug) {
      return [];
    }

    const translated = normalizeSegmentForCollision(translatedSlug);
    const originalKey = `${language}\0${original}`;
    const translatedKey = `${language}\0${translated}`;
    const translatedOwnersForSegment = translatedOwners.get(translatedKey);

    if (
      (originalCounts.get(originalKey) ?? 0) !== 1
      || (translatedOwnersForSegment?.size ?? 0) !== 1
      || (translated !== original && originalCounts.has(translatedKey))
    ) {
      return [];
    }

    return [{
      originalSlug: row.originalSlug,
      translatedSlug,
      langTo: row.langTo,
    }];
  });
}
