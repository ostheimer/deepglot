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
    appUrl: normalizeUrl(env.DEEPGLOT_PHASE6_APP_URL ?? "https://deepglot.ai"),
    wordpressUrl: normalizeUrl(
      env.DEEPGLOT_PHASE6_WORDPRESS_URL ?? "https://www.meinhaushalt.at"
    ),
    projectId:
      env.DEEPGLOT_PHASE6_PROJECT_ID?.trim() ||
      env.MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID?.trim() ||
      null,
    apiKey:
      env.DEEPGLOT_PHASE6_API_KEY?.trim() ||
      env.MEINHAUSHALT_PROD_DEEPGLOT_API_KEY?.trim() ||
      null,
    editorSecret: env.DEEPGLOT_EDITOR_SECRET?.trim() || null,
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
  const token = createEditorSessionToken(
    {
      projectId: config.projectId,
      domain: new URL(config.wordpressUrl).hostname,
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
