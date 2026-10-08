import {
  WORDPRESS_INFRASTRUCTURE_SLUG_SEGMENTS,
  buildRuntimeUrlSlugs,
  normalizeRuntimeSlugCollisionKey,
} from "@/lib/runtime-url-slugs";

export type UrlSlugEditRow = {
  id: string;
  originalSlug: string;
  translatedSlug: string | null;
  langTo: string;
};

export type UrlSlugEditErrorCode = "invalid_slug" | "reserved_slug" | "slug_collision";
export class UrlSlugEditError extends Error {
  constructor(public readonly code: UrlSlugEditErrorCode) {
    super(code);
  }
}

const reserved = new Set<string>(WORDPRESS_INFRASTRUCTURE_SLUG_SEGMENTS);

/** Match the plugin's one-pass percent decoding, then persist a plain segment. */
export function normalizeEditableSlug(value: string): string {
  const decoded = normalizeRuntimeSlugCollisionKey(value);
  if (
    !decoded || decoded === "." || decoded === ".." ||
    new TextEncoder().encode(decoded).length > 200 ||
    /[\x00-\x20\x7f/\\?#%]/u.test(decoded)
  ) {
    throw new UrlSlugEditError("invalid_slug");
  }
  return decoded;
}

export function validateUrlSlugEdit(
  value: string | null,
  editedId: string,
  rows: UrlSlugEditRow[],
): string | null {
  if (value === null) return null;
  const target = normalizeEditableSlug(value);
  if (reserved.has(target)) throw new UrlSlugEditError("reserved_slug");
  const edited = rows.find((row) => row.id === editedId);
  if (!edited) throw new UrlSlugEditError("invalid_slug");
  const source = normalizeRuntimeSlugCollisionKey(edited.originalSlug);
  if (
    !source || source === "." || source === ".." ||
    new TextEncoder().encode(source).length > 200 ||
    /[\x00-\x20\x7f/\\?#]/u.test(source) ||
    reserved.has(source)
  ) {
    throw new UrlSlugEditError("invalid_slug");
  }
  const language = edited.langTo.toLowerCase();
  for (const row of rows) {
    if (row.langTo.toLowerCase() !== language) continue;
    const original = normalizeRuntimeSlugCollisionKey(row.originalSlug);
    if (original === target && row.id !== editedId) {
      throw new UrlSlugEditError("slug_collision");
    }
    const translated = row.translatedSlug ? normalizeRuntimeSlugCollisionKey(row.translatedSlug) : null;
    if (translated === target && row.id !== editedId) {
      throw new UrlSlugEditError("slug_collision");
    }
  }
  const prospectiveRows = rows.map((row) => row.id === editedId
    ? { ...row, translatedSlug: target }
    : row);
  const accepted = buildRuntimeUrlSlugs(prospectiveRows).some((row) =>
    row.originalSlug === edited.originalSlug
    && row.langTo.toLowerCase() === language
    && row.translatedSlug === target,
  );
  if (!accepted) throw new UrlSlugEditError("slug_collision");
  return target;
}
