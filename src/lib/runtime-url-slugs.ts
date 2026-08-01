export const MAX_RUNTIME_URL_SLUGS = 10_000;

/** Keep aligned with the WordPressInfrastructure plugin support class. */
export const WORDPRESS_INFRASTRUCTURE_SLUG_SEGMENTS = [
  "wp-json",
  "wp-admin",
  "wp-content",
  "wp-includes",
  "wp-login.php",
  "wp-cron.php",
  "xmlrpc.php",
  "wp-comments-post.php",
  "wp-mail.php",
  "wp-trackback.php",
  "wp-signup.php",
  "wp-activate.php",
  "wp-links-opml.php",
  "robots.txt",
  "wp-sitemap.xml",
  "deepglot-sitemap.xml",
] as const;

const WORDPRESS_INFRASTRUCTURE_SLUG_SET = new Set<string>(
  WORDPRESS_INFRASTRUCTURE_SLUG_SEGMENTS,
);

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

function normalizeSegmentForCollision(value: string): string | null {
  const trimmed = value.trim();
  // PHP rawurldecode() decodes every valid %HH byte while preserving malformed
  // percent signs. Escape only malformed signs before decodeURIComponent() so
  // mixed input such as `foo%2Dbar%` follows the same one-pass semantics.
  const protectedMalformedPercents = trimmed.replace(
    /%(?![0-9a-f]{2})/gi,
    "%25",
  );
  try {
    return decodeURIComponent(protectedMalformedPercents).toLocaleLowerCase("und");
  } catch {
    // A syntactically valid %HH sequence can still contain invalid UTF-8.
    // The PHP normalizers reject that after rawurldecode(), so omit it here too.
    return null;
  }
}

function isReservedWordPressSegment(normalizedSegment: string) {
  return WORDPRESS_INFRASTRUCTURE_SLUG_SET.has(normalizedSegment);
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
    if (
      !language
      || !original
      || isReservedWordPressSegment(original)
    ) {
      continue;
    }

    const originalKey = `${language}\0${original}`;
    originalCounts.set(originalKey, (originalCounts.get(originalKey) ?? 0) + 1);

    const translatedSlug = row.translatedSlug?.trim();
    if (!translatedSlug) {
      continue;
    }

    const translated = normalizeSegmentForCollision(translatedSlug);
    if (!translated || isReservedWordPressSegment(translated)) {
      continue;
    }

    const translatedKey = `${language}\0${translated}`;
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
    if (!translated) {
      return [];
    }

    const originalKey = `${language}\0${original}`;
    const translatedKey = `${language}\0${translated}`;
    const translatedOwnersForSegment = translatedOwners.get(translatedKey);

    if (
      (originalCounts.get(originalKey) ?? 0) !== 1
      || (translatedOwnersForSegment?.size ?? 0) !== 1
      || isReservedWordPressSegment(original)
      || isReservedWordPressSegment(translated)
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
