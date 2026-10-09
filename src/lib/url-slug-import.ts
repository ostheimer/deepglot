import type { SlugCsvRow } from "@/lib/import-export";
import { buildRuntimeUrlSlugs, normalizeRuntimeSlugCollisionKey, WORDPRESS_INFRASTRUCTURE_SLUG_SEGMENTS } from "@/lib/runtime-url-slugs";
import { normalizeEditableSlug, UrlSlugEditError, validateUrlSlugEdit, type UrlSlugEditRow } from "@/lib/url-slug-edit";

export class UrlSlugImportConflict extends Error {
  constructor(
    public readonly line: number,
    public readonly original: string,
    public readonly target: string,
    public readonly reason: string,
  ) {
    super(`Line ${line}: ${original} → ${target || "(empty)"}: ${reason}`);
  }
}

/** Validate the whole CSV against the resulting project map before writing. */
export function planUrlSlugImport(rows: SlugCsvRow[], existing: UrlSlugEditRow[]): SlugCsvRow[] {
  const prospective = existing.map((row) => ({ ...row }));
  const byExactSource = new Map(prospective.map((row) => [`${row.langTo.toLowerCase()}\0${row.originalSlug}`, row]));
  const byNormalizedSource = new Map(prospective.map((row) => [
    `${row.langTo.toLowerCase()}\0${normalizeRuntimeSlugCollisionKey(row.originalSlug)}`, row,
  ]));
  const keys = new Set<string>();
  for (const row of rows) {
    const source = normalizeRuntimeSlugCollisionKey(row.originalSlug);
    const key = `${row.langTo.toLowerCase()}\0${source}`;
    const alias = byNormalizedSource.get(key);
    if (!source || keys.has(key) || (alias && (alias.originalSlug !== row.originalSlug || alias.langTo !== row.langTo))) {
      throw new UrlSlugImportConflict(row.line, row.originalSlug, row.translatedSlug, "duplicate or invalid source");
    }
    keys.add(key);
    const exactKey = `${row.langTo.toLowerCase()}\0${row.originalSlug}`;
    const current = byExactSource.get(exactKey);
    if (current) current.translatedSlug = row.translatedSlug || null;
    else {
      const added = { id: `csv:${row.line}`, originalSlug: row.originalSlug, translatedSlug: row.translatedSlug || null, langTo: row.langTo };
      prospective.push(added);
      byExactSource.set(exactKey, added);
      byNormalizedSource.set(key, added);
    }
  }

  const runtime = new Set(buildRuntimeUrlSlugs(prospective).map((row) =>
    `${row.langTo.toLowerCase()}\0${row.originalSlug}\0${row.translatedSlug}`));
  const reserved = new Set<string>(WORDPRESS_INFRASTRUCTURE_SLUG_SEGMENTS);

  return rows.map((row) => {
    const item = byExactSource.get(`${row.langTo.toLowerCase()}\0${row.originalSlug}`);
    if (!item) throw new UrlSlugImportConflict(row.line, row.originalSlug, row.translatedSlug, "missing source");
    if (!row.translatedSlug) return { ...row, translatedSlug: "" };
    try {
      const translatedSlug = normalizeEditableSlug(row.translatedSlug);
      if (reserved.has(translatedSlug)) throw new UrlSlugEditError("reserved_slug");
      if (!runtime.has(`${row.langTo.toLowerCase()}\0${row.originalSlug}\0${translatedSlug}`)) {
        validateUrlSlugEdit(row.translatedSlug, item.id, prospective);
        throw new UrlSlugEditError("slug_collision");
      }
      return { ...row, translatedSlug };
    } catch (error) {
      if (error instanceof UrlSlugEditError) {
        throw new UrlSlugImportConflict(row.line, row.originalSlug, row.translatedSlug, error.code);
      }
      throw error;
    }
  });
}
