export type TestLoginEnv = Record<string, string | undefined>;

export type TestLoginConfig = {
  email: string;
  name: string;
  password: string;
  organizationName: string;
  organizationSlug: string;
  projectName: string;
  projectDomain: string;
};

const DEFAULT_TEST_LOGIN_CONFIG: TestLoginConfig = {
  email: "preview@deepglot.local",
  name: "Deepglot Test",
  password: "deepglot-preview-login",
  organizationName: "Deepglot Test-Workspace",
  organizationSlug: "deepglot-test-workspace",
  projectName: "Deepglot Demo-Projekt",
  projectDomain: "demo.deepglot.local",
};

function normalizeBooleanFlag(value: string | undefined): boolean | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return null;
}

export function isTestLoginEnabled(env: TestLoginEnv = process.env): boolean {
  const explicitValue = normalizeBooleanFlag(env.DEEPGLOT_ENABLE_TEST_LOGIN);
  if (explicitValue !== null) {
    return explicitValue;
  }

  return env.NODE_ENV === "development" || env.VERCEL_ENV === "preview";
}

export function getTestLoginConfig(
  env: TestLoginEnv = process.env
): TestLoginConfig {
  const inferredProjectDomain =
    env.TEST_LOGIN_PROJECT_DOMAIN ||
    env.VERCEL_URL ||
    (env.NODE_ENV === "development" ? "localhost:3000" : undefined) ||
    DEFAULT_TEST_LOGIN_CONFIG.projectDomain;

  return {
    email: env.TEST_LOGIN_EMAIL || DEFAULT_TEST_LOGIN_CONFIG.email,
    name: env.TEST_LOGIN_NAME || DEFAULT_TEST_LOGIN_CONFIG.name,
    password: env.TEST_LOGIN_PASSWORD || DEFAULT_TEST_LOGIN_CONFIG.password,
    organizationName:
      env.TEST_LOGIN_ORGANIZATION_NAME ||
      DEFAULT_TEST_LOGIN_CONFIG.organizationName,
    organizationSlug:
      env.TEST_LOGIN_ORGANIZATION_SLUG ||
      DEFAULT_TEST_LOGIN_CONFIG.organizationSlug,
    projectName: env.TEST_LOGIN_PROJECT_NAME || DEFAULT_TEST_LOGIN_CONFIG.projectName,
    projectDomain: inferredProjectDomain,
  };
}
