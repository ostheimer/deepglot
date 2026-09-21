/** Numeric types reported by the legacy-compatible translation request contract. */
export const WordType = {
  OTHER: 0,
  TEXT: 1,
  VALUE: 2,
  PLACEHOLDER: 3,
  META_CONTENT: 4,
  IFRAME_SRC: 5,
  IMG_SRC: 6,
  IMG_ALT: 7,
  PDF_HREF: 8,
  PAGE_TITLE: 9,
  EXTERNAL_LINK: 10,
} as const;

export const REPORTED_TYPE_GROUPS = {
  text: [1, 2, 3, 4, 7, 9],
  media: [5, 6, 8],
  link: [10],
  other: [0],
} as const;
export type ReportedTypeFilter = keyof typeof REPORTED_TYPE_GROUPS | "unknown";

/** No string coercion, content guessing, or default TEXT for older clients. */
export function collectReportedTypes(
  words: readonly { t?: unknown }[],
  hashes: readonly string[],
) {
  const observations = new Map<string, { hash: string; wordType: number }>();
  words.forEach((word, index) => {
    const hash = hashes[index];
    const type = word.t;
    if (
      !hash ||
      typeof type !== "number" ||
      !Number.isInteger(type) ||
      type < 0 ||
      type > 10
    )
      return;
    observations.set(`${hash}:${type}`, { hash, wordType: type });
  });
  return [...observations.values()];
}
