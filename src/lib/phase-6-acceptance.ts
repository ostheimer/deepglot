import type { AcceptanceCheck } from "@/lib/acceptance-report";
import { createEditorSessionToken } from "@/lib/editor-session";

export type Phase6AcceptanceEnv = {
  [key: string]: string | undefined;
  DEEPGLOT_PHASE6_APP_URL?: string;
  DEEPGLOT_PHASE6_WORDPRESS_URL?: string;
  DEEPGLOT_PHASE6_PROJECT_ID?: string;
  DEEPGLOT_PHASE6_API_KEY?: string;
  DEEPGLOT_PHASE6_SUBDOMAIN_HOST?: string;
  MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID?: string;
  MEINHAUSHALT_PROD_DEEPGLOT_API_KEY?: string;
  DEEPGLOT_EDITOR_SECRET?: string;
  AUTH_SECRET?: string;
  NEXTAUTH_SECRET?: string;
};

export type Phase6AcceptanceConfig = {
  appUrl: string;
  wordpressUrl: string;
  projectId: string | null;
  apiKey: string | null;
  editorSecret: string | null;
  subdomainHost: string | null;
};

export function resolvePhase6AcceptanceConfig(
  env: Phase6AcceptanceEnv = process.env
): Phase6AcceptanceConfig {
  return {
    appUrl: normalizeUrl(env.DEEPGLOT_PHASE6_APP_URL?.trim() || "https://deepglot.ai"),
    wordpressUrl: normalizeUrl(
      env.DEEPGLOT_PHASE6_WORDPRESS_URL?.trim() ||
        "https://www.meinhaushalt.at"
    ),
    projectId:
      env.DEEPGLOT_PHASE6_PROJECT_ID?.trim() ||
      env.MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID?.trim() ||
      null,
    apiKey:
      env.DEEPGLOT_PHASE6_API_KEY?.trim() ||
      env.MEINHAUSHALT_PROD_DEEPGLOT_API_KEY?.trim() ||
      null,
    editorSecret:
      env.DEEPGLOT_EDITOR_SECRET?.trim() ||
      env.AUTH_SECRET?.trim() ||
      env.NEXTAUTH_SECRET?.trim() ||
      null,
    subdomainHost: env.DEEPGLOT_PHASE6_SUBDOMAIN_HOST?.trim() || null,
  };
}

export function buildRuntimeConfigUrl(config: Phase6AcceptanceConfig) {
  if (!config.apiKey) {
    return null;
  }

  const url = new URL("/api/plugin/runtime-config", config.appUrl);
  url.searchParams.set("api_key", config.apiKey);
  return url.toString();
}

export function buildEditorBootUrl({
  config,
  path = "/en/",
  ttlSeconds = 900,
}: {
  config: Phase6AcceptanceConfig;
  path?: string;
  ttlSeconds?: number;
}) {
  if (!config.projectId || !config.editorSecret) {
    return null;
  }

  const url = new URL(path, config.wordpressUrl);
  const langTo = path.split("/").filter(Boolean)[0] ?? "en";
  const token = createEditorSessionToken(
    {
      projectId: config.projectId,
      domain: new URL(config.wordpressUrl).hostname,
      langTo,
      ttlSeconds,
    },
    config.editorSecret
  );
  url.searchParams.set("deepglot_editor", "1");
  url.searchParams.set("deepglot_editor_project", config.projectId);
  url.searchParams.set("deepglot_editor_token", token);
  url.searchParams.set("deepglot_phase6", String(Date.now()));

  return url.toString();
}

export function buildSubdomainAcceptanceUrl(host: string, now = Date.now()) {
  const trimmed = host.trim();
  if (!trimmed) {
    return null;
  }

  const base = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL("/", base);
    if (!url.hostname) {
      return null;
    }

    url.searchParams.set("deepglot_phase6", String(now));
    return url.toString();
  } catch {
    return null;
  }
}

export function buildBlockedPhase6Check({
  name,
  missing,
}: {
  name: string;
  missing: string[];
}): AcceptanceCheck {
  return {
    name,
    status: "BLOCKED",
    detail: `Missing required runtime configuration: ${missing.join(", ")}.`,
  };
}

export function classifyPhase6CommandFailure(output: string): "BLOCKED" | "FAIL" {
  if (
    /Can't reach database server|P1001|PrismaClientInitializationError|ECONNREFUSED.*5432|database server .* not reachable/i.test(
      output
    )
  ) {
    return "BLOCKED";
  }

  if (/php: command not found|env: php: No such file/i.test(output)) {
    return "BLOCKED";
  }

  return "FAIL";
}

function normalizeUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "https://deepglot.ai";
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export type BrowserRedirectProbe = {
  status: number;
  location: string | null;
};

export type BrowserRedirectProbes = {
  /** Accept-Language en, browser UA, no preference cookie. */
  englishFirstVisit: BrowserRedirectProbe;
  /** Accept-Language matching the site source language, no cookie. */
  sourceLanguageVisit: BrowserRedirectProbe;
  /** Crawler user agent (must match the plugin's bot regex). */
  botVisit: BrowserRedirectProbe;
  /** deepglot_preferred_language cookie set to the source language. */
  cookieVisit: BrowserRedirectProbe;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function probeRedirects(probe: BrowserRedirectProbe) {
  return REDIRECT_STATUSES.has(probe.status) && Boolean(probe.location);
}

/**
 * Classifies the browser-language auto-redirect state from four live probes.
 *
 * The check is enablement-aware: the site owner may run with auto-redirect
 * disabled (guarded rollout — no request redirects) or enabled. Both are
 * acceptable; what must ALWAYS hold are the guards. A redirect for a bot,
 * for a source-language visitor, or for a visitor with a stored language
 * preference is a real regression regardless of the rollout state
 * (BrowserRedirector: bot skip, source-language skip, cookie skip).
 */
export function classifyBrowserRedirectProbes(probes: BrowserRedirectProbes): {
  status: "PASS" | "FAIL";
  detail: string;
} {
  const guardViolations: string[] = [];

  if (probeRedirects(probes.botVisit)) {
    guardViolations.push(
      `bot request redirected (${probes.botVisit.status} -> ${probes.botVisit.location})`
    );
  }

  if (probeRedirects(probes.sourceLanguageVisit)) {
    guardViolations.push(
      `source-language visitor redirected (${probes.sourceLanguageVisit.status} -> ${probes.sourceLanguageVisit.location})`
    );
  }

  if (probeRedirects(probes.cookieVisit)) {
    guardViolations.push(
      `stored cookie preference overridden (${probes.cookieVisit.status} -> ${probes.cookieVisit.location})`
    );
  }

  if (guardViolations.length > 0) {
    return { status: "FAIL", detail: `Guard broken: ${guardViolations.join("; ")}.` };
  }

  if (!probeRedirects(probes.englishFirstVisit)) {
    return {
      status: "PASS",
      detail: `Auto-redirect disabled (guarded rollout): ${probes.englishFirstVisit.status}; no redirect for any probe.`,
    };
  }

  const location = probes.englishFirstVisit.location ?? "";
  const pointsToLocalizedPath = /\/[a-z]{2}(-[a-z]{2})?\//i.test(
    new URL(location, "https://placeholder.invalid").pathname + "/"
  );

  if (!pointsToLocalizedPath) {
    return {
      status: "FAIL",
      detail: `Auto-redirect enabled but redirect target is not a localized path: ${probes.englishFirstVisit.status} -> ${location}.`,
    };
  }

  return {
    status: "PASS",
    detail: `Auto-redirect enabled and guarded: first-visit ${probes.englishFirstVisit.status} -> ${location}; bot/source-language/cookie probes stay unredirected.`,
  };
}
