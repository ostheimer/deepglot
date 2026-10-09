import type { Prisma } from "@prisma/client";
import { getProjectUrl } from "./project-url";

/** Only same-origin HTTP page paths are suitable as workspace navigation. */
export function translationContextPath(
  requestUrl: string | null | undefined,
  domain: string,
  allowedTargetHosts: string[] = [],
) {
  if (!requestUrl) return null;
  try {
    const url = new URL(requestUrl);
    const permittedHosts = [domain, ...allowedTargetHosts].map((host) => {
      const candidate = new URL(getProjectUrl(host));
      return `${candidate.hostname}:${candidate.port}`;
    });
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !permittedHosts.includes(`${url.hostname}:${url.port}`)
    )
      return null;
    const path = url.pathname;
    if (
      path.length > 2048 ||
      path.startsWith("//") ||
      /[\u0000-\u001f\\]/.test(decodeURIComponent(path))
    )
      return null;
    return path;
  } catch {
    return null;
  }
}

export function translationContextLink(domain: string, path: string) {
  try {
    const site = new URL(getProjectUrl(domain));
    if (
      !["http:", "https:"].includes(site.protocol) ||
      site.username ||
      site.password
    )
      return null;
    const url = new URL(path, site.origin);
    return translationContextPath(url.href, domain) === path ? url.href : null;
  } catch {
    return null;
  }
}

export async function recordTranslationContexts(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    domain: string;
    requestUrl?: string | null;
    langFrom: string;
    langTo: string;
    hashes: string[];
  },
) {
  const mappedHosts = await tx.projectDomainMapping.findMany({
    where: { projectId: input.projectId, langCode: input.langTo },
    select: { host: true },
  });
  const mappedPath = translationContextPath(input.requestUrl, input.domain, mappedHosts.map((item) => item.host));
  if (!mappedPath || input.hashes.length === 0) return;
  const translations = await tx.translation.findMany({
    where: {
      projectId: input.projectId,
      langFrom: input.langFrom,
      langTo: input.langTo,
      originalHash: { in: [...new Set(input.hashes)] },
    },
    select: { id: true },
  });
  if (!translations.length) return;
  const now = new Date();
  await tx.translationContext.createMany({
    data: translations.map(({ id }) => ({
      translationId: id,
      urlPath: mappedPath,
      firstSeenAt: now,
      lastSeenAt: now,
    })),
    skipDuplicates: true,
  });
  await tx.translationContext.updateMany({
    where: { translationId: { in: translations.map(({ id }) => id) }, urlPath: mappedPath },
    data: { lastSeenAt: now },
  });
}
