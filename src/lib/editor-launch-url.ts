import { getProjectUrl } from "@/lib/project-url";

export function buildEditorLaunchUrl({
  domain,
  routingMode,
  domainMappings,
  langTo,
  projectId,
  token,
}: {
  domain: string;
  routingMode: "PATH_PREFIX" | "SUBDOMAIN";
  domainMappings: Array<{ langCode: string; host: string }>;
  langTo: string;
  projectId: string;
  token: string;
}) {
  const mapping =
    routingMode === "SUBDOMAIN"
      ? domainMappings.find((item) => item.langCode === langTo)
      : undefined;
  const baseUrl = getProjectUrl(mapping?.host ?? domain);

  const url = new URL(baseUrl);

  if (routingMode === "PATH_PREFIX" || !mapping) {
    const pathname = url.pathname.replace(/\/$/, "");
    url.pathname = `${pathname}/${langTo}`.replace(/\/{2,}/g, "/");
  }

  url.searchParams.set("deepglot_editor", "1");
  url.searchParams.set("deepglot_editor_project", projectId);
  url.searchParams.set("deepglot_editor_token", token);

  return url.toString();
}
