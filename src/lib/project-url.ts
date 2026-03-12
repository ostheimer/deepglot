const LOCAL_HOST_PATTERN = /^(localhost|127(?:\.\d{1,3}){3})(:\d+)?$/i;

export function getProjectUrl(domain: string): string {
  const trimmed = domain.trim();
  if (!trimmed) {
    throw new Error("Project domain is required.");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const protocol = LOCAL_HOST_PATTERN.test(trimmed) ? "http" : "https";
  return `${protocol}://${trimmed}`;
}

export function getVisualEditorUrl(domain: string): string | null {
  try {
    const url = new URL(getProjectUrl(domain));
    url.searchParams.set("deepglot_editor", "1");
    return url.toString();
  } catch {
    return null;
  }
}
