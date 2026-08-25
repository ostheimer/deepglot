import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

function readProjectFile(relativePath: string): string {
  const absolutePath = path.join(projectRoot, relativePath);

  assert.ok(
    existsSync(absolutePath),
    `Expected independent page-view analytics file: ${relativePath}`,
  );

  return readFileSync(absolutePath, "utf8");
}

test("real page views have their own privacy-minimized event model", () => {
  const schema = readProjectFile("prisma/schema.prisma");
  const pageViewModel = schema.match(/model PageView\s*\{([\s\S]*?)\n\}/)?.[1];

  assert.ok(pageViewModel, "PageView must not reuse TranslatedUrl.requestCount");
  assert.match(pageViewModel, /projectId\s+String/);
  assert.match(pageViewModel, /urlPath\s+String/);
  assert.match(pageViewModel, /langTo\s+String/);
  assert.match(pageViewModel, /eventId\s+String\s+@unique/);
  assert.match(pageViewModel, /createdAt\s+DateTime/);
  assert.doesNotMatch(pageViewModel, /\b(?:ipAddress|userAgent|referrer|visitorId|cookieId)\b/);
});

test("the page-view dashboard never relabels historical translation requests", () => {
  const dashboard = readProjectFile(
    "src/app/(dashboard)/projekte/[projektId]/statistiken/seitenaufrufe/page.tsx",
  );

  assert.match(dashboard, /db\.pageView\./);
  assert.doesNotMatch(dashboard, /requestCount/);
  assert.doesNotMatch(dashboard, /db\.translatedUrl\./);
  assert.match(dashboard, /AnalyticsRangeSelector/);

  const translationRequests = readProjectFile(
    "src/app/(dashboard)/projekte/[projektId]/statistiken/anfragen/page.tsx",
  );
  assert.match(translationRequests, /requestCount/);
});

test("the collector requires explicit opt-in and project-authenticated ingestion", () => {
  const collector = readProjectFile("src/app/api/plugin/page-views/route.ts");

  assert.match(collector, /validateApiKey/);
  assert.match(collector, /pageViewsEnabled/);
  assert.match(collector, /db\.pageView\.(?:create|upsert)/);
});

test("plugin runtime configuration propagates the opt-in without exposing API keys", () => {
  const runtimeConfig = readProjectFile("src/app/api/plugin/runtime-config/route.ts");
  const options = readProjectFile(
    "wordpress-plugin/deepglot/includes/Config/Options.php",
  );

  assert.match(runtimeConfig, /pageViewsEnabled/);
  assert.match(options, /page_views_enabled/);
  assert.match(options, /pageViewsEnabled/);
});

test("translated-page tracking remains independent of dynamic translation", () => {
  const tracker = readProjectFile(
    "wordpress-plugin/deepglot/assets/js/page-view-tracker.js",
  );
  const assets = readProjectFile(
    "wordpress-plugin/deepglot/includes/Frontend/PageViewAssets.php",
  );
  const controller = readProjectFile(
    "wordpress-plugin/deepglot/includes/Frontend/PageViewController.php",
  );
  const plugin = readProjectFile("wordpress-plugin/deepglot/includes/Plugin.php");

  assert.match(tracker, /(?:sendBeacon|keepalive)/);
  assert.match(tracker, /sessionStorage/);
  assert.match(assets, /page-view-tracker\.js/);
  assert.match(assets, /pageViews|PageView/);
  assert.doesNotMatch(assets, /shouldTranslateDynamicContent/);
  assert.match(controller, /BotDetector/);
  assert.match(plugin, /PageViewAssets::class/);
  assert.match(plugin, /PageViewController::class/);
});

test("enabling page-view collection is restricted to project managers", () => {
  const activation = readProjectFile(
    "src/app/api/projects/[projektId]/page-views/activate/route.ts",
  );

  assert.match(activation, /userCanManageProject\(/);
});

test("legacy enabled flags cannot silently become informed tracking consent", () => {
  const schema = readProjectFile("prisma/schema.prisma");
  const collector = readProjectFile("src/app/api/plugin/page-views/route.ts");
  const runtimeConfig = readProjectFile("src/app/api/plugin/runtime-config/route.ts");
  const activation = readProjectFile(
    "src/app/api/projects/[projektId]/page-views/activate/route.ts",
  );
  const dashboard = readProjectFile(
    "src/app/(dashboard)/projekte/[projektId]/statistiken/seitenaufrufe/page.tsx",
  );

  assert.match(schema, /pageViewsConsentGrantedAt\s+DateTime\?/);
  assert.match(collector, /pageViewsConsentGrantedAt/);
  assert.match(runtimeConfig, /pageViewsConsentGrantedAt/);
  assert.match(activation, /pageViewsConsentGrantedAt:\s*(?:new Date\(\)|consentGrantedAt)/);
  assert.match(dashboard, /pageViewsConsentGrantedAt/);
});

test("retention is explicitly documented and enforced by scheduled cleanup", () => {
  const privacyPolicy = readProjectFile("src/app/datenschutz/page.tsx");
  const localizedPrivacyCopy = readProjectFile("src/lib/page-view-copy.ts");
  const pageViews = readProjectFile("src/lib/page-views.ts");
  const cronConfig = readProjectFile("vercel.json");
  const cleanupRoute = readProjectFile("src/app/api/cron/page-view-retention/route.ts");

  assert.match(privacyPolicy, /pageViewPrivacyDisclosure/);
  assert.match(localizedPrivacyCopy, /90\s+(?:days|Tage(?:n)?)/i);
  assert.match(pageViews, /PAGE_VIEW_RETENTION_DAYS\s*=\s*90/);
  assert.match(cleanupRoute, /deleteMany/);
  assert.match(cronConfig, /page-view-retention/);
});
