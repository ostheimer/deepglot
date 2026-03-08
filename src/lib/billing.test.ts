import test from "node:test";
import assert from "node:assert/strict";

import { getBillingPortalReturnUrl } from "@/lib/billing";

function restoreEnv(
  authUrl: string | undefined,
  appUrl: string | undefined,
  vercel: string | undefined,
  vercelEnv: string | undefined,
  vercelBranchUrl: string | undefined,
  vercelUrl: string | undefined,
  vercelProductionUrl: string | undefined
): void {
  if (typeof authUrl === "undefined") {
    delete process.env.AUTH_URL;
  } else {
    process.env.AUTH_URL = authUrl;
  }

  if (typeof appUrl === "undefined") {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = appUrl;
  }

  if (typeof vercel === "undefined") {
    delete process.env.VERCEL;
  } else {
    process.env.VERCEL = vercel;
  }

  if (typeof vercelEnv === "undefined") {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = vercelEnv;
  }

  if (typeof vercelBranchUrl === "undefined") {
    delete process.env.VERCEL_BRANCH_URL;
  } else {
    process.env.VERCEL_BRANCH_URL = vercelBranchUrl;
  }

  if (typeof vercelUrl === "undefined") {
    delete process.env.VERCEL_URL;
  } else {
    process.env.VERCEL_URL = vercelUrl;
  }

  if (typeof vercelProductionUrl === "undefined") {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  } else {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = vercelProductionUrl;
  }
}

test("uses AUTH_URL for the billing portal return URL", () => {
  const originalAuthUrl = process.env.AUTH_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalVercelBranchUrl = process.env.VERCEL_BRANCH_URL;
  const originalVercelUrl = process.env.VERCEL_URL;
  const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  try {
    process.env.AUTH_URL = "https://auth.deepglot.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.deepglot.test";

    assert.equal(
      getBillingPortalReturnUrl(),
      "https://auth.deepglot.test/subscription/billing"
    );
  } finally {
    restoreEnv(
      originalAuthUrl,
      originalAppUrl,
      originalVercel,
      originalVercelEnv,
      originalVercelBranchUrl,
      originalVercelUrl,
      originalVercelProductionUrl
    );
  }
});

test("falls back to NEXT_PUBLIC_APP_URL when AUTH_URL is missing", () => {
  const originalAuthUrl = process.env.AUTH_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalVercelBranchUrl = process.env.VERCEL_BRANCH_URL;
  const originalVercelUrl = process.env.VERCEL_URL;
  const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  try {
    delete process.env.AUTH_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://app.deepglot.test";

    assert.equal(
      getBillingPortalReturnUrl(),
      "https://app.deepglot.test/subscription/billing"
    );
  } finally {
    restoreEnv(
      originalAuthUrl,
      originalAppUrl,
      originalVercel,
      originalVercelEnv,
      originalVercelBranchUrl,
      originalVercelUrl,
      originalVercelProductionUrl
    );
  }
});

test("falls back to Vercel preview system URLs when explicit app URLs are missing", () => {
  const originalAuthUrl = process.env.AUTH_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalVercelBranchUrl = process.env.VERCEL_BRANCH_URL;
  const originalVercelUrl = process.env.VERCEL_URL;
  const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  try {
    delete process.env.AUTH_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "deepglot-git-preview.vercel.app";

    assert.equal(
      getBillingPortalReturnUrl(),
      "https://deepglot-git-preview.vercel.app/subscription/billing"
    );
  } finally {
    restoreEnv(
      originalAuthUrl,
      originalAppUrl,
      originalVercel,
      originalVercelEnv,
      originalVercelBranchUrl,
      originalVercelUrl,
      originalVercelProductionUrl
    );
  }
});

test("falls back to the Vercel production URL in production deployments", () => {
  const originalAuthUrl = process.env.AUTH_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalVercelBranchUrl = process.env.VERCEL_BRANCH_URL;
  const originalVercelUrl = process.env.VERCEL_URL;
  const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  try {
    delete process.env.AUTH_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "deepglot.com";

    assert.equal(
      getBillingPortalReturnUrl(),
      "https://deepglot.com/subscription/billing"
    );
  } finally {
    restoreEnv(
      originalAuthUrl,
      originalAppUrl,
      originalVercel,
      originalVercelEnv,
      originalVercelBranchUrl,
      originalVercelUrl,
      originalVercelProductionUrl
    );
  }
});

test("throws a clear error when no billing portal base URL is configured", () => {
  const originalAuthUrl = process.env.AUTH_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalVercelBranchUrl = process.env.VERCEL_BRANCH_URL;
  const originalVercelUrl = process.env.VERCEL_URL;
  const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  try {
    delete process.env.AUTH_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_BRANCH_URL;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

    assert.throws(() => getBillingPortalReturnUrl(), {
      message:
        "Missing AUTH_URL, NEXT_PUBLIC_APP_URL, or Vercel system URL for the billing portal return URL.",
    });
  } finally {
    restoreEnv(
      originalAuthUrl,
      originalAppUrl,
      originalVercel,
      originalVercelEnv,
      originalVercelBranchUrl,
      originalVercelUrl,
      originalVercelProductionUrl
    );
  }
});
