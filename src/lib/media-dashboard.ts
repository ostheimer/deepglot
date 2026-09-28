export type MediaMapping = {
  id: string;
  originalUrl: string;
  localizedUrl: string;
  langTo: string;
};
export type MediaFilterKind = "image" | "document" | "video" | "embed";

/** Display classification of API-validated URLs; this does not validate input. */
export function mediaDisplayKind(url: string): MediaFilterKind {
  if (
    url.startsWith("https://www.youtube") ||
    url.startsWith("https://player.vimeo.com/")
  )
    return "embed";
  const path = url.split("?")[0];
  if (/\.(pdf|docx|xlsx|pptx)$/i.test(path)) return "document";
  if (/\.(mp4|webm)$/i.test(path)) return "video";
  return "image";
}

export function filterMediaMappings(
  rows: MediaMapping[],
  query: string,
  language: string,
  kind: string,
): MediaMapping[] {
  const search = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (!language || row.langTo === language) &&
      (!kind || mediaDisplayKind(row.originalUrl) === kind) &&
      (!search ||
        `${row.originalUrl}\n${row.localizedUrl}`
          .toLowerCase()
          .includes(search)),
  );
}
