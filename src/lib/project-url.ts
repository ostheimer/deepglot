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

/** Keep the plugin-reported install path only when it belongs to this project host. */
export function getWordPressSettingsUrl(domain: string, syncSiteHost?: string | null): string {
  const projectUrl = new URL(getProjectUrl(domain));
  let installPath = projectUrl.pathname;

  if (syncSiteHost) {
    try {
      const siteUrl = new URL(`https://${syncSiteHost}`);
      const comparableHost = (host: string) => host.toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
      if (comparableHost(siteUrl.hostname) === comparableHost(projectUrl.hostname) && siteUrl.port === projectUrl.port) {
        installPath = siteUrl.pathname;
      }
    } catch {
      // Keep the project URL when the older plugin identity is malformed.
    }
  }

  const base = installPath.replace(/\/+$/, "");
  return `${projectUrl.origin}${base}/wp-admin/options-general.php?page=deepglot`;
}
