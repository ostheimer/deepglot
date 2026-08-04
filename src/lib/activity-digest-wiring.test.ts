import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("persists opt-in preferences and per-recipient digest delivery claims", () => {
  const schema = read("prisma/schema.prisma");

  assert.match(schema, /activityDigestEnabled\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /activityDigestLocale\s+String\s+@default\("en"\)/);
  assert.match(schema, /model ActivityDigestDelivery\s*\{/);
  assert.match(
    schema,
    /@@unique\(\[organizationId, recipientUserId, periodStart\]\)/
  );
});

test("wires the persisted preference control into account settings", () => {
  const settingsPage = read("src/app/(dashboard)/einstellungen/page.tsx");
  const preferenceRoute = read("src/app/api/user/activity-digest/route.ts");
  const preferenceControl = read(
    "src/components/einstellungen/activity-digest-preferences.tsx"
  );

  assert.match(settingsPage, /ActivityDigestPreferences/);
  assert.match(settingsPage, /activityDigestEnabled/);
  assert.match(preferenceRoute, /session\.user\.id/);
  assert.match(preferenceRoute, /organizationMember\.update/);
  assert.match(preferenceRoute, /activityDigestLocale/);
  assert.doesNotMatch(
    preferenceControl,
    /uiText\(\s*locale,\s*`Weekly digest for \$\{/
  );
  assert.match(
    preferenceControl,
    /uiText\(\s*locale,\s*"Project and workspace activity"/
  );
});

test("the cron route runs the digest processor behind cron authentication", () => {
  const route = read("src/app/api/cron/activity-digest/route.ts");
  const delivery = read("src/lib/activity-digest-delivery.ts");

  assert.match(route, /isActivityDigestRequestAuthorized/);
  assert.match(route, /processWeeklyActivityDigests/);
  assert.match(route, /runtime = "nodejs"/);
  assert.match(route, /dynamic = "force-dynamic"/);
  assert.match(delivery, /where: \{ activityDigestEnabled: true \}/);
  assert.match(
    delivery,
    /activityDigestDelivery\.create[\s\S]*sendActivityDigestEmail/
  );
  assert.match(
    delivery,
    /sendActivityDigestEmail[\s\S]*activityDigestDelivery[\s\S]*deleteMany/
  );
});
