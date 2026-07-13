import {
  buildAcceptanceReport,
  getAcceptanceExitCode,
  renderAcceptanceText,
  type AcceptanceCheck,
} from "@/lib/acceptance-report";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { runVisualEditorPersistenceAcceptance } from "@/lib/visual-editor-acceptance";

function printHelp() {
  console.log(`Usage: npm run acceptance:visual-editor

Creates isolated temporary project data in the configured PostgreSQL database,
exercises the Visual Editor token and manual-save routes, verifies persistence
and project/language isolation, and removes the temporary rows before exit.
Run only against a local, disposable, or CI database.`);
}

function isLocalDatabase(connectionString: string) {
  try {
    const hostname = new URL(connectionString).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

async function runCheck(): Promise<AcceptanceCheck> {
  const startedAt = Date.now();
  const result = await runVisualEditorPersistenceAcceptance();
  const passed =
    result.verificationStatus === 200 &&
    result.verifiedProjectId === result.projectId &&
    result.verifiedLanguage === "en" &&
    result.saveStatus === 200 &&
    result.persistedTranslation?.isManual === true &&
    result.persistedTranslation.source === "MANUAL" &&
    result.crossProjectStatus === 401 &&
    result.crossLanguageStatus === 403 &&
    result.deniedTranslationCount === 0;

  return {
    name: "Visual Editor persistence and isolation",
    status: passed ? "PASS" : "FAIL",
    detail: `verify=${result.verificationStatus}; save=${result.saveStatus}; crossProject=${result.crossProjectStatus}; crossLanguage=${result.crossLanguageStatus}; deniedWrites=${result.deniedTranslationCount}.`,
    durationMs: Date.now() - startedAt,
  };
}

async function main() {
  if (process.argv.slice(2).includes("--help")) {
    printHelp();
    return;
  }

  if (process.argv.length > 2) {
    throw new Error("Unknown argument. Use --help for usage.");
  }

  const databaseUrl = resolveDatabaseUrl();
  let check: AcceptanceCheck;

  if (!databaseUrl) {
    check = {
      name: "Visual Editor persistence and isolation",
      status: "BLOCKED",
      detail: "DEEPGLOT_DATABASE_URL or DATABASE_URL is required.",
    };
  } else if (!isLocalDatabase(databaseUrl)) {
    check = {
      name: "Visual Editor persistence and isolation",
      status: "BLOCKED",
      detail: "Refusing temporary acceptance writes to a non-local database.",
    };
  } else {
    check = await runCheck();
  }

  const report = buildAcceptanceReport({
    name: "Deepglot Visual Editor acceptance",
    checks: [check],
  });

  console.log(renderAcceptanceText(report));
  process.exitCode = getAcceptanceExitCode(report, true);
}

main()
  .catch((error: unknown) => {
    console.error(
      `FAIL Visual Editor acceptance: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    const databaseUrl = resolveDatabaseUrl();
    if (databaseUrl && isLocalDatabase(databaseUrl)) {
      const { db } = await import("@/lib/db");
      await db.$disconnect();
    }
  });
