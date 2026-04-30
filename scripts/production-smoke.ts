import { Resolver } from "node:dns/promises";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const productionUrl = normalizeUrl(
  process.env.DEEPGLOT_PRODUCTION_URL ?? "https://deepglot.ai"
);
const wwwUrl = normalizeUrl(process.env.DEEPGLOT_WWW_URL ?? "https://www.deepglot.ai");
const wordpressUrl = normalizeUrl(
  process.env.DEEPGLOT_WORDPRESS_URL ?? "https://www.meinhaushalt.at"
);
const expectedDnsIp = process.env.DEEPGLOT_EXPECTED_DNS_IP ?? "76.76.21.21";
const dnsServers = (process.env.DEEPGLOT_DNS_SERVERS ?? "1.1.1.1,8.8.8.8")
  .split(",")
  .map((server) => server.trim())
  .filter(Boolean);
const legacyAliasUrls = (process.env.DEEPGLOT_LEGACY_ALIAS_URLS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map(normalizeUrl);

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function endpoint(baseUrl: string, path: string) {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function checkHttpStatus(name: string, url: string, expectedStatus: number) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Deepglot production smoke" },
    });

    return result(
      name,
      response.status === expectedStatus,
      `${response.status} ${response.statusText} from ${url}`
    );
  } catch (error) {
    return result(name, false, getErrorMessage(error));
  }
}

async function checkRedirect(
  name: string,
  url: string,
  expectedStatus: number,
  expectedLocation: string
) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Deepglot production smoke" },
    });
    const location = response.headers.get("location") ?? "";

    return result(
      name,
      response.status === expectedStatus && location === expectedLocation,
      `${response.status}; location=${location || "(none)"}`
    );
  } catch (error) {
    return result(name, false, getErrorMessage(error));
  }
}

async function checkDns(name: string, host: string) {
  const resolver = new Resolver();
  resolver.setServers(dnsServers);

  try {
    const addresses = await resolver.resolve4(host);
    return result(
      name,
      addresses.includes(expectedDnsIp),
      `${host} -> ${addresses.join(", ") || "(none)"} via ${dnsServers.join(", ")}`
    );
  } catch (error) {
    return result(name, false, getErrorMessage(error));
  }
}

async function checkWordPressTranslation() {
  const url = endpoint(wordpressUrl, `/en/?deepglot_smoke=${Date.now()}`);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Deepglot production smoke" },
    });
    const html = await response.text();
    const visibleText = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const hasEnglishSignals = /Jump to content|Homepage|Household|Categories/i.test(
      visibleText
    );
    const hasRawLanguageMarker = html.includes("[en]");

    return result(
      "WordPress translated path",
      response.ok && hasEnglishSignals && !hasRawLanguageMarker,
      `${response.status}; englishSignals=${hasEnglishSignals}; rawMarker=${hasRawLanguageMarker}`
    );
  } catch (error) {
    return result("WordPress translated path", false, getErrorMessage(error));
  }
}

function result(name: string, ok: boolean, detail: string): CheckResult {
  return { name, ok, detail };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function printResults(results: CheckResult[]) {
  for (const check of results) {
    const prefix = check.ok ? "PASS" : "FAIL";
    console.log(`${prefix} ${check.name}: ${check.detail}`);
  }
}

async function main() {
  const legacyAliasChecks = legacyAliasUrls.map((aliasUrl) => {
    return checkRedirect(
      `Legacy alias canonical redirect (${new URL(aliasUrl).hostname})`,
      endpoint(aliasUrl, "/pricing"),
      308,
      endpoint(productionUrl, "/pricing")
    );
  });

  const checks = await Promise.all([
    checkHttpStatus("Apex public status", endpoint(productionUrl, "/api/public/status"), 200),
    checkHttpStatus("WWW public status", endpoint(wwwUrl, "/api/public/status"), 200),
    checkHttpStatus("Apex pricing page", endpoint(productionUrl, "/pricing"), 200),
    checkRedirect(
      "WWW page canonical redirect",
      endpoint(wwwUrl, "/pricing"),
      308,
      endpoint(productionUrl, "/pricing")
    ),
    checkDns("Apex DNS", new URL(productionUrl).hostname),
    checkDns("WWW DNS", new URL(wwwUrl).hostname),
    checkWordPressTranslation(),
    ...legacyAliasChecks,
  ]);

  printResults(checks);

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`Production smoke failed: ${failed.length}/${checks.length} checks failed.`);
    process.exit(1);
  }

  console.log(`Production smoke passed: ${checks.length}/${checks.length} checks passed.`);
}

void main();
