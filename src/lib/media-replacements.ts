import { isIP } from "node:net";

export const MAX_RUNTIME_MEDIA_REPLACEMENTS = 500;
export const MAX_MEDIA_IMAGE_URL_LENGTH = 2048;

const SAFE_IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|avif|gif)$/i;
const SAFE_LANGUAGE_CODE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ENCODED_UNSAFE_CHARACTER = /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i;
const RECURSIVELY_ENCODED_PATH_DELIMITER = /%(?:2e|2f|5c)/i;
const MALFORMED_PERCENT_ESCAPE = /%(?![0-9a-f]{2})/i;
const DOT_PATH_SEGMENT = /(?:^|\/)(?:\.|%2e){1,2}(?=\/|$)/i;

export type RuntimeMediaReplacementRow = {
  originalUrl: string;
  localizedUrl: string;
  langTo: string;
};

export class MediaReplacementError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_PROJECT_DOMAIN"
      | "INVALID_IMAGE_URL"
      | "INVALID_IMAGE_FORMAT"
      | "INVALID_TARGET_LANGUAGE"
      | "DUPLICATE_IMAGE_REPLACEMENT"
      | "MEDIA_REPLACEMENTS_LIMIT_EXCEEDED"
  ) {
    super(message);
    this.name = "MediaReplacementError";
  }
}

export function assertMediaReplacementCapacity(currentCount: number): void {
  if (currentCount >= MAX_RUNTIME_MEDIA_REPLACEMENTS) {
    throw new MediaReplacementError(
      `A project can contain at most ${MAX_RUNTIME_MEDIA_REPLACEMENTS} image replacements.`,
      "MEDIA_REPLACEMENTS_LIMIT_EXCEEDED"
    );
  }
}

function invalidImageUrl(message: string): never {
  throw new MediaReplacementError(message, "INVALID_IMAGE_URL");
}

function normalizedPublicHostname(hostname: string): string {
  const normalized = hostname
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "")
    .toLowerCase();

  if (
    !normalized ||
    isIP(normalized) !== 0 ||
    normalized === "localhost" ||
    [".localhost", ".local", ".internal", ".lan"].some((suffix) =>
      normalized.endsWith(suffix)
    )
  ) {
    throw new MediaReplacementError(
      "The project must use a public, non-IP hostname.",
      "INVALID_PROJECT_DOMAIN"
    );
  }

  return normalized;
}

function getProjectOrigin(projectDomain: string): URL {
  const normalizedDomain = projectDomain.trim();
  if (
    !normalizedDomain ||
    CONTROL_CHARACTER.test(normalizedDomain) ||
    normalizedDomain.includes("\\") ||
    normalizedDomain.includes("#") ||
    normalizedDomain.includes("?")
  ) {
    throw new MediaReplacementError(
      "The project domain is not a valid public hostname.",
      "INVALID_PROJECT_DOMAIN"
    );
  }

  let projectOrigin: URL;
  try {
    projectOrigin = new URL(`https://${normalizedDomain}`);
  } catch {
    throw new MediaReplacementError(
      "The project domain is not a valid public hostname.",
      "INVALID_PROJECT_DOMAIN"
    );
  }

  if (
    projectOrigin.username ||
    projectOrigin.password ||
    projectOrigin.pathname !== "/"
  ) {
    throw new MediaReplacementError(
      "The project domain must contain only its public hostname and optional port.",
      "INVALID_PROJECT_DOMAIN"
    );
  }

  normalizedPublicHostname(projectOrigin.hostname);

  return projectOrigin;
}

/**
 * Store same-project image URLs in one root-relative canonical form so absolute
 * and relative references cannot create duplicate or cross-origin mappings.
 * The SaaS never fetches these URLs; browsers only receive validated paths.
 */
export function normalizeMediaImageUrl(
  rawImageUrl: string,
  projectDomain: string
): string {
  const projectOrigin = getProjectOrigin(projectDomain);
  const imageUrl = rawImageUrl.trim();

  if (
    !imageUrl ||
    imageUrl.length > MAX_MEDIA_IMAGE_URL_LENGTH ||
    CONTROL_CHARACTER.test(imageUrl) ||
    imageUrl.includes("\\") ||
    imageUrl.includes("#") ||
    imageUrl.startsWith("//") ||
    ENCODED_UNSAFE_CHARACTER.test(imageUrl) ||
    MALFORMED_PERCENT_ESCAPE.test(imageUrl)
  ) {
    invalidImageUrl("The image URL contains unsafe or ambiguous characters.");
  }

  const rawPath = imageUrl.split("?")[0];
  if (DOT_PATH_SEGMENT.test(rawPath)) {
    invalidImageUrl("The image URL must not contain traversal segments.");
  }

  if (!imageUrl.startsWith("/") && !/^https:\/\//i.test(imageUrl)) {
    invalidImageUrl("Images must use a root-relative path or same-project HTTPS URL.");
  }

  let parsedImageUrl: URL;
  try {
    parsedImageUrl = new URL(imageUrl, projectOrigin);
  } catch {
    return invalidImageUrl("The image URL is malformed.");
  }

  if (
    parsedImageUrl.protocol !== "https:" ||
    parsedImageUrl.username ||
    parsedImageUrl.password ||
    parsedImageUrl.port !== projectOrigin.port ||
    normalizedPublicHostname(parsedImageUrl.hostname) !==
      normalizedPublicHostname(projectOrigin.hostname)
  ) {
    invalidImageUrl("Images must belong to the same public project hostname.");
  }

  // Match WordPress rawurldecode exactly once, including non-UTF-8 bytes, and
  // reject only the encoded path delimiters its runtime will subsequently drop.
  const decodedPath = parsedImageUrl.pathname.replace(
    /%([0-9a-f]{2})/gi,
    (_escape, hexadecimalByte: string) =>
      String.fromCharCode(Number.parseInt(hexadecimalByte, 16))
  );

  if (RECURSIVELY_ENCODED_PATH_DELIMITER.test(decodedPath)) {
    invalidImageUrl("The image URL contains recursively encoded path delimiters.");
  }

  if (!SAFE_IMAGE_EXTENSION.test(parsedImageUrl.pathname)) {
    throw new MediaReplacementError(
      "Only PNG, JPG, JPEG, WebP, AVIF, and GIF images are supported.",
      "INVALID_IMAGE_FORMAT"
    );
  }

  const canonicalImageUrl = `${parsedImageUrl.pathname}${parsedImageUrl.search}`.replace(
    /%[0-9a-f]{2}/gi,
    (escape) => escape.toUpperCase()
  );

  if (canonicalImageUrl.length > MAX_MEDIA_IMAGE_URL_LENGTH) {
    invalidImageUrl("The canonical image URL exceeds the maximum supported length.");
  }

  return canonicalImageUrl;
}

/** Build the compact, language-scoped contract consumed by the WordPress plugin. */
export function buildRuntimeMediaReplacements(
  rows: RuntimeMediaReplacementRow[]
): Record<string, Record<string, string>> {
  if (rows.length > MAX_RUNTIME_MEDIA_REPLACEMENTS) {
    throw new MediaReplacementError(
      "The project image mapping exceeds the runtime safety limit.",
      "MEDIA_REPLACEMENTS_LIMIT_EXCEEDED"
    );
  }

  const replacements: Record<string, Record<string, string>> = {};

  for (const row of rows) {
    const language = row.langTo.trim().toLowerCase();
    if (!SAFE_LANGUAGE_CODE.test(language)) {
      throw new MediaReplacementError(
        "The image mapping contains an invalid target language.",
        "INVALID_TARGET_LANGUAGE"
      );
    }

    if (!row.originalUrl.startsWith("/") || !row.localizedUrl.startsWith("/")) {
      invalidImageUrl("Persisted image mappings must remain root-relative.");
    }

    const originalUrl = normalizeMediaImageUrl(row.originalUrl, "deepglot.invalid");
    const localizedUrl = normalizeMediaImageUrl(row.localizedUrl, "deepglot.invalid");

    if (originalUrl !== row.originalUrl || localizedUrl !== row.localizedUrl) {
      invalidImageUrl("Persisted image mappings must use their canonical form.");
    }

    const languageReplacements = (replacements[language] ??= {});
    if (Object.hasOwn(languageReplacements, originalUrl)) {
      throw new MediaReplacementError(
        "The project contains duplicate image replacement keys.",
        "DUPLICATE_IMAGE_REPLACEMENT"
      );
    }

    languageReplacements[originalUrl] = localizedUrl;
  }

  return replacements;
}
