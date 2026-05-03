import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

import {
  buildAcceptanceReport,
  getAcceptanceExitCode,
  renderAcceptanceJson,
  renderAcceptanceJunit,
  renderAcceptanceText,
  type AcceptanceCheck,
} from "@/lib/acceptance-report";
import { redactAcceptanceOutput } from "@/lib/production-acceptance";
import {
  buildSaasSettingsSyncPayload,
  buildSaasTranslatePayload,
  describeSaasBatchLogVerificationError,
  resolveSaasAcceptanceConfig,
  type SaasAcceptanceConfig,
} from "@/lib/saas-acceptance";

type Options = {
  prodEnvFile: string;
  localEnvFile: string;
  jsonFile: string | null;
  junitFile: string | null;
  strict: boolean;
  skipLive: boolean;
};

type LoadedEnvFile = {
  path: string;
  exists: boolean;
  values: Record<string, string>;
};

type CookieJar = {
  store(response: Response): void;
  header(): string;
};

type AuthResult = {
  check: AcceptanceCheck;
  jar: CookieJar | null;
};

type ProjectFlowResult = {
  check: AcceptanceCheck;
  runtimeSyncCheck: AcceptanceCheck | null;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    prodEnvFile: ".env.production.local",
    localEnvFile: ".env.local",
    jsonFile: null,
    junitFile: null,
    strict: false,
    skipLive: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--prod-env-file" && next) {
      options.prodEnvFile = next;
      index += 1;
    } else if (arg === "--local-env-file" && next) {
      options.localEnvFile = next;
      index += 1;
    } else if (arg === "--json" && next) {
      options.jsonFile = next;
      index += 1;
    } else if (arg === "--junit" && next) {
      options.junitFile = next;
      index += 1;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--skip-live") {
      options.skipLive = true;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run acceptance:saas -- [options]

Options:
  --prod-env-file <path>       Production dotenv file. Default: .env.production.local
  --local-env-file <path>      Local dotenv file with dashboard credentials. Default: .env.local
  --json <path>                Write a JSON report.
  --junit <path>               Write a JUnit XML report.
  --strict                     Exit non-zero for blocked or skipped checks.
  --skip-live                  Skip production SaaS HTTP/API checks.

Default mode is production-safe. It may create and delete a disposable SaaS
project if valid dashboard credentials are configured. It does not touch Stripe
resources or WordPress content.`);
}

function loadEnvFile(filePath: string): LoadedEnvFile {
  if (!existsSync(filePath)) {
    return { path: filePath, exists: false, values: {} };
  }

  return {
    path: filePath,
    exists: true,
    values: dotenv.parse(readFileSync(filePath)),
  };
}

function mergeAcceptanceEnv(prodEnvFile: LoadedEnvFile, localEnvFile: LoadedEnvFile) {
  return {
    ...prodEnvFile.values,
    ...localEnvFile.values,
    ...process.env,
  };
}

function applyEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value.trim()) {
      process.env[key] = value;
    }
  }
}

function writeReportFile(filePath: string, contents: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function createCookieJar(): CookieJar {
  const cookies = new Map<string, string>();

  return {
    store(response: Response) {
      const setCookie = response.headers.getSetCookie?.() ?? [];
      for (const cookie of setCookie) {
        const [pair] = cookie.split(";");
        const separatorIndex = pair.indexOf("=");
        if (separatorIndex > 0) {
          cookies.set(pair.slice(0, separatorIndex), pair.slice(separatorIndex + 1));
        }
      }
    },
    header() {
      return Array.from(cookies.entries())
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
    },
  };
}

async function checkAuth(config: SaasAcceptanceConfig): Promise<AuthResult> {
  const startedAt = Date.now();

  if (!config.dashboardEmail || !config.dashboardPassword) {
    return {
      check: {
        name: "SaaS auth credentials",
        status: "BLOCKED",
        detail:
          "DEEPGLOT_DASHBOARD_EMAIL and DEEPGLOT_DASHBOARD_PASSWORD are required.",
      },
      jar: null,
    };
  }

  const jar = createCookieJar();

  try {
    const csrfResponse = await fetch(new URL("/api/auth/csrf", config.appUrl), {
      headers: { "User-Agent": "Deepglot SaaS acceptance" },
      signal: AbortSignal.timeout(20_000),
    });
    jar.store(csrfResponse);
    const csrfBody = (await csrfResponse.json().catch(() => null)) as {
      csrfToken?: string;
    } | null;

    if (!csrfResponse.ok || !csrfBody?.csrfToken) {
      return {
        check: {
          name: "SaaS auth credentials",
          status: "FAIL",
          detail: `${csrfResponse.status}; could not obtain CSRF token.`,
          durationMs: Date.now() - startedAt,
        },
        jar: null,
      };
    }

    const body = new URLSearchParams({
      csrfToken: csrfBody.csrfToken,
      email: config.dashboardEmail,
      password: config.dashboardPassword,
      callbackUrl: new URL("/dashboard", config.appUrl).toString(),
      redirect: "false",
    });
    const loginResponse = await fetch(
      new URL("/api/auth/callback/credentials", config.appUrl),
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: jar.header(),
          "User-Agent": "Deepglot SaaS acceptance",
        },
        body,
        signal: AbortSignal.timeout(20_000),
      }
    );
    jar.store(loginResponse);
    const location = loginResponse.headers.get("location") ?? "";

    if (location.includes("CredentialsSignin")) {
      return {
        check: {
          name: "SaaS auth credentials",
          status: "BLOCKED",
          detail:
            "Configured dashboard credentials were rejected by production.",
          durationMs: Date.now() - startedAt,
        },
        jar: null,
      };
    }

    const dashboardResponse = await fetch(new URL("/dashboard", config.appUrl), {
      redirect: "manual",
      headers: {
        Cookie: jar.header(),
        "User-Agent": "Deepglot SaaS acceptance",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (dashboardResponse.status >= 300 && dashboardResponse.status < 400) {
      return {
        check: {
          name: "SaaS auth credentials",
          status: "BLOCKED",
          detail: `Authentication did not create a dashboard session; redirected to ${dashboardResponse.headers.get("location") ?? "(none)"}.`,
          durationMs: Date.now() - startedAt,
        },
        jar: null,
      };
    }

    return {
      check: {
        name: "SaaS auth credentials",
        status: dashboardResponse.ok ? "PASS" : "FAIL",
        detail: `${dashboardResponse.status}; dashboard session ${dashboardResponse.ok ? "accepted" : "not accepted"}.`,
        durationMs: Date.now() - startedAt,
      },
      jar: dashboardResponse.ok ? jar : null,
    };
  } catch (error) {
    return {
      check: {
        name: "SaaS auth credentials",
        status: "FAIL",
        detail: getErrorMessage(error),
        durationMs: Date.now() - startedAt,
      },
      jar: null,
    };
  }
}

async function checkProjectFlow(
  config: SaasAcceptanceConfig,
  auth: AuthResult
): Promise<ProjectFlowResult> {
  const startedAt = Date.now();
  const jar = auth.jar;

  if (!jar) {
    return {
      check: {
        name: "SaaS project flow",
        status: "BLOCKED",
        detail: "Skipped because SaaS auth did not produce a session.",
      },
      runtimeSyncCheck: null,
    };
  }

  let projectId: string | null = null;
  let rawKey: string | null = null;

  try {
    const createResponse = await fetch(new URL("/api/projects", config.appUrl), {
      method: "POST",
      headers: jsonHeaders(jar),
      body: JSON.stringify({
        name: "Deepglot acceptance",
        domain: config.projectDomain,
        originalLang: "de",
        languages: ["en"],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const createBody = (await createResponse.json().catch(() => null)) as
      | { projectId?: string; rawKey?: string; error?: string }
      | null;

    if (createResponse.status === 403) {
      return {
        check: {
          name: "SaaS project flow",
          status: "BLOCKED",
          detail: `Project creation blocked: ${createBody?.error ?? "permission or plan limit"}.`,
          durationMs: Date.now() - startedAt,
        },
        runtimeSyncCheck: null,
      };
    }

    if (!createResponse.ok || !createBody?.projectId || !createBody.rawKey) {
      return {
        check: {
          name: "SaaS project flow",
          status: "FAIL",
          detail: `${createResponse.status}; project creation did not return projectId/rawKey.`,
          durationMs: Date.now() - startedAt,
        },
        runtimeSyncCheck: null,
      };
    }

    projectId = createBody.projectId;
    rawKey = createBody.rawKey;

    const languageResponse = await fetch(
      new URL(`/api/projects/${projectId}/languages`, config.appUrl),
      {
        method: "POST",
        headers: jsonHeaders(jar),
        body: JSON.stringify({ languages: ["fr"] }),
        signal: AbortSignal.timeout(20_000),
      }
    );

    if (!languageResponse.ok) {
      return failProjectFlow(languageResponse, "language update", startedAt);
    }

    const apiKeyResponse = await fetch(
      new URL(`/api/projects/${projectId}/api-keys`, config.appUrl),
      {
        method: "POST",
        headers: jsonHeaders(jar),
        body: JSON.stringify({ name: "Acceptance key" }),
        signal: AbortSignal.timeout(20_000),
      }
    );

    if (!apiKeyResponse.ok) {
      return failProjectFlow(apiKeyResponse, "API key creation", startedAt);
    }

    const deleteLanguageResponse = await fetch(
      new URL(`/api/projects/${projectId}/languages`, config.appUrl),
      {
        method: "DELETE",
        headers: jsonHeaders(jar),
        body: JSON.stringify({ langCode: "fr" }),
        signal: AbortSignal.timeout(20_000),
      }
    );

    if (!deleteLanguageResponse.ok) {
      return failProjectFlow(
        deleteLanguageResponse,
        "language deletion",
        startedAt
      );
    }

    const runtimeSyncCheck = await checkRuntimeSync({
      config,
      disposableApiKey: rawKey,
    });

    return {
      check: {
        name: "SaaS project flow",
        status: "PASS",
        detail: "Created disposable project, generated API key, updated languages, and deleted the project.",
        durationMs: Date.now() - startedAt,
      },
      runtimeSyncCheck,
    };
  } catch (error) {
    return {
      check: {
        name: "SaaS project flow",
        status: "FAIL",
        detail: getErrorMessage(error),
        durationMs: Date.now() - startedAt,
      },
      runtimeSyncCheck: rawKey
        ? await checkRuntimeSync({ config, disposableApiKey: rawKey })
        : null,
    };
  } finally {
    if (projectId) {
      await fetch(new URL(`/api/projects/${projectId}`, config.appUrl), {
        method: "DELETE",
        headers: jsonHeaders(jar),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
    }
  }
}

async function checkTranslationApi(config: SaasAcceptanceConfig): Promise<AcceptanceCheck> {
  const startedAt = new Date();
  const startedMs = Date.now();

  if (!config.apiKey || !config.projectId) {
    return {
      name: "SaaS translation API",
      status: "BLOCKED",
      detail:
        "DEEPGLOT_SAAS_API_KEY/PROJECT_ID or MEINHAUSHALT_PROD_DEEPGLOT_API_KEY/PROJECT_ID is required.",
    };
  }

  const requestUrl = `https://acceptance.deepglot.test/${startedMs}`;

  try {
    const response = await fetch(new URL("/api/translate", config.appUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Deepglot SaaS acceptance",
      },
      body: JSON.stringify(buildSaasTranslatePayload({ requestUrl })),
      signal: AbortSignal.timeout(30_000),
      // Keep API keys out of logs/details by using Authorization instead of query params.
    });

    const retryAfter = response.headers.get("retry-after");
    const body = (await response.json().catch(() => null)) as
      | { from_words?: unknown; to_words?: unknown; error?: string }
      | null;

    if (response.status === 401 || response.status === 429) {
      return {
        name: "SaaS translation API",
        status: "BLOCKED",
        detail: `${response.status}; ${body?.error ?? "API key rejected or rate-limited"}${retryAfter ? `; retryAfter=${retryAfter}` : ""}.`,
        durationMs: Date.now() - startedMs,
      };
    }

    const validShape =
      response.ok &&
      Array.isArray(body?.from_words) &&
      Array.isArray(body?.to_words) &&
      body.from_words.length === body.to_words.length;

    if (!validShape) {
      return {
        name: "SaaS translation API",
        status: "FAIL",
        detail: `${response.status}; translation response shape was invalid.`,
        durationMs: Date.now() - startedMs,
      };
    }

    let batchCount: number | null;
    try {
      batchCount = await countTranslationBatchLogs({
        projectId: config.projectId,
        requestUrl,
        createdAfter: startedAt,
      });
    } catch (error) {
      const verificationError = describeSaasBatchLogVerificationError(
        getErrorMessage(error)
      );

      return {
        name: "SaaS translation API",
        status: verificationError.status,
        detail: verificationError.detail,
        durationMs: Date.now() - startedMs,
      };
    }

    return {
      name: "SaaS translation API",
      status: batchCount == null ? "BLOCKED" : batchCount > 0 ? "PASS" : "FAIL",
      detail:
        batchCount == null
          ? "Translation response shape passed, but database batch-log verification is blocked by missing DATABASE_URL."
          : `Translation response shape passed; batchLogs=${batchCount}.`,
      durationMs: Date.now() - startedMs,
    };
  } catch (error) {
    return {
      name: "SaaS translation API",
      status: "FAIL",
      detail: getErrorMessage(error),
      durationMs: Date.now() - startedMs,
    };
  }
}

async function checkRuntimeSync({
  config,
  disposableApiKey,
}: {
  config: SaasAcceptanceConfig;
  disposableApiKey: string | null;
}): Promise<AcceptanceCheck> {
  const startedAt = Date.now();

  if (!disposableApiKey) {
    return {
      name: "SaaS runtime settings sync",
      status: "BLOCKED",
      detail:
        "Skipped because a disposable project API key was not available; live project settings are not mutated by acceptance.",
    };
  }

  try {
    const response = await fetch(new URL("/api/plugin/settings-sync", config.appUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${disposableApiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Deepglot SaaS acceptance",
      },
      body: JSON.stringify(buildSaasSettingsSyncPayload()),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          project?: {
            settings?: { runtimeSyncedAt?: string | null; routingMode?: string };
          };
          error?: string;
        }
      | null;

    if (response.status === 401 || response.status === 429) {
      return {
        name: "SaaS runtime settings sync",
        status: "BLOCKED",
        detail: `${response.status}; ${body?.error ?? "API key rejected or rate-limited"}.`,
        durationMs: Date.now() - startedAt,
      };
    }

    const synced =
      response.ok &&
      body?.ok === true &&
      body.project?.settings?.routingMode === "PATH_PREFIX" &&
      typeof body.project.settings.runtimeSyncedAt === "string";

    return {
      name: "SaaS runtime settings sync",
      status: synced ? "PASS" : "FAIL",
      detail: `${response.status}; runtimeSynced=${synced}.`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name: "SaaS runtime settings sync",
      status: "FAIL",
      detail: getErrorMessage(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

function failProjectFlow(
  response: Response,
  step: string,
  startedAt: number
): ProjectFlowResult {
  return {
    check: {
      name: "SaaS project flow",
      status: "FAIL",
      detail: `${response.status}; ${step} failed.`,
      durationMs: Date.now() - startedAt,
    },
    runtimeSyncCheck: null,
  };
}

function jsonHeaders(jar: CookieJar) {
  return {
    "Content-Type": "application/json",
    Cookie: jar.header(),
    "User-Agent": "Deepglot SaaS acceptance",
  };
}

async function countTranslationBatchLogs({
  projectId,
  requestUrl,
  createdAfter,
}: {
  projectId: string;
  requestUrl: string;
  createdAfter: Date;
}) {
  if (!process.env.DATABASE_URL && !process.env.DEEPGLOT_DATABASE_URL) {
    return null;
  }

  const { db } = await import("@/lib/db");
  return db.translationBatchLog.count({
    where: {
      projectId,
      requestUrl,
      createdAt: { gte: createdAfter },
    },
  });
}

function skippedCheck(name: string): AcceptanceCheck {
  return { name, status: "SKIPPED", detail: "Skipped by --skip-live." };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? redactSaasOutput(error.message) : String(error);
}

function redactSaasOutput(value: string) {
  return redactAcceptanceOutput(value)
    .replace(/dg_(?:live|test)_[A-Za-z0-9._~+/=-]+/g, "dg_[redacted]")
    .replace(/password=([^&\s]+)/gi, "password=[redacted]")
    .replace(/email=([^&\s]+)/gi, "email=[redacted]");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prodEnvFile = loadEnvFile(options.prodEnvFile);
  const localEnvFile = loadEnvFile(options.localEnvFile);
  const env = mergeAcceptanceEnv(prodEnvFile, localEnvFile);
  applyEnv(env);
  const config = resolveSaasAcceptanceConfig(env);
  const checks: AcceptanceCheck[] = [];

  if (options.skipLive) {
    checks.push(
      skippedCheck("SaaS auth credentials"),
      skippedCheck("SaaS project flow"),
      skippedCheck("SaaS translation API"),
      skippedCheck("SaaS runtime settings sync")
    );
  } else {
    const authResult = await checkAuth(config);
    checks.push(authResult.check);

    const projectFlowResult = await checkProjectFlow(config, authResult);
    checks.push(projectFlowResult.check);

    checks.push(await checkTranslationApi(config));
    checks.push(
      projectFlowResult.runtimeSyncCheck ??
        (await checkRuntimeSync({
          config,
          disposableApiKey: null,
        }))
    );
  }

  const report = buildAcceptanceReport({
    name: "Deepglot SaaS acceptance",
    checks,
  });

  if (options.jsonFile) {
    writeReportFile(options.jsonFile, renderAcceptanceJson(report));
  }

  if (options.junitFile) {
    writeReportFile(options.junitFile, renderAcceptanceJunit(report));
  }

  console.log(renderAcceptanceText(report));
  process.exit(getAcceptanceExitCode(report, options.strict));
}

main().catch((error) => {
  console.error(redactSaasOutput(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
