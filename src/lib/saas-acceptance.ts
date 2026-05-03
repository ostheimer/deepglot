export type SaasAcceptanceEnv = {
  [key: string]: string | undefined;
  DEEPGLOT_SAAS_APP_URL?: string;
  DEEPGLOT_DASHBOARD_URL?: string;
  DEEPGLOT_DASHBOARD_EMAIL?: string;
  DEEPGLOT_DASHBOARD_PASSWORD?: string;
  DEEPGLOT_SAAS_PROJECT_ID?: string;
  DEEPGLOT_SAAS_API_KEY?: string;
  DEEPGLOT_SAAS_PROJECT_DOMAIN?: string;
  MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID?: string;
  MEINHAUSHALT_PROD_DEEPGLOT_API_KEY?: string;
};

export type SaasAcceptanceConfig = {
  appUrl: string;
  dashboardEmail: string | null;
  dashboardPassword: string | null;
  projectId: string | null;
  apiKey: string | null;
  projectDomain: string;
};

export type SaasSettingsSyncPayload = {
  routingMode: "PATH_PREFIX";
  siteUrl: string;
  sourceLanguage: string;
  targetLanguages: string[];
  autoRedirect: boolean;
  translateEmails: boolean;
  translateSearch: boolean;
  translateAmp: boolean;
  domainMappings: [];
};

export function resolveSaasAcceptanceConfig(
  env: SaasAcceptanceEnv = process.env,
  now = new Date()
): SaasAcceptanceConfig {
  const appUrl =
    env.DEEPGLOT_SAAS_APP_URL?.trim() ||
    env.DEEPGLOT_DASHBOARD_URL?.trim() ||
    "https://deepglot.ai";

  return {
    appUrl: normalizeUrl(appUrl),
    dashboardEmail: env.DEEPGLOT_DASHBOARD_EMAIL?.trim() || null,
    dashboardPassword: env.DEEPGLOT_DASHBOARD_PASSWORD?.trim() || null,
    projectId:
      env.DEEPGLOT_SAAS_PROJECT_ID?.trim() ||
      env.MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID?.trim() ||
      null,
    apiKey:
      env.DEEPGLOT_SAAS_API_KEY?.trim() ||
      env.MEINHAUSHALT_PROD_DEEPGLOT_API_KEY?.trim() ||
      null,
    projectDomain:
      env.DEEPGLOT_SAAS_PROJECT_DOMAIN?.trim() ||
      buildDisposableProjectDomain(now),
  };
}

export function buildDisposableProjectDomain(now = new Date()) {
  const timestamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  return `acceptance-${timestamp}.deepglot.test`;
}

export function buildSaasTranslatePayload({
  requestUrl,
  text = "Hallo Deepglot acceptance",
}: {
  requestUrl: string;
  text?: string;
}) {
  return {
    l_from: "de",
    l_to: "en",
    request_url: requestUrl,
    title: "Deepglot SaaS acceptance",
    bot: 0,
    words: [{ t: 1, w: text }],
  };
}

export function buildSaasSettingsSyncPayload(
  siteUrl = "https://www.meinhaushalt.at"
): SaasSettingsSyncPayload {
  return {
    routingMode: "PATH_PREFIX",
    siteUrl,
    sourceLanguage: "de",
    targetLanguages: ["en"],
    autoRedirect: false,
    translateEmails: false,
    translateSearch: false,
    translateAmp: false,
    domainMappings: [],
  };
}

export function classifySaasCommandFailure(output: string): "BLOCKED" | "FAIL" {
  if (
    /Can't reach database server|P1001|PrismaClientInitializationError|ECONNREFUSED.*5432|database server .* not reachable/i.test(
      output
    )
  ) {
    return "BLOCKED";
  }

  return "FAIL";
}

export function describeSaasBatchLogVerificationError(output: string): {
  status: "BLOCKED" | "FAIL";
  detail: string;
} {
  const status = classifySaasCommandFailure(output);

  return {
    status,
    detail:
      status === "BLOCKED"
        ? "Translation response shape passed, but database batch-log verification is blocked by database connectivity."
        : output,
  };
}

function normalizeUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "https://deepglot.ai";
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
