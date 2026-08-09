import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { generateMetadata } from "@/app/hilfe/page";

const ROOT = process.cwd();

function read(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("help metadata publishes only the bilingual canonical routes", async () => {
  const [english, german, unsupported] = await Promise.all([
    generateMetadata({ searchParams: Promise.resolve({ __locale: "en" }) }),
    generateMetadata({ searchParams: Promise.resolve({ __locale: "de" }) }),
    generateMetadata({ searchParams: Promise.resolve({ __locale: "fr" }) }),
  ]);

  assert.equal(english.alternates?.canonical, "/help");
  assert.equal(german.alternates?.canonical, "/de/hilfe");
  assert.equal(unsupported.alternates?.canonical, "/help");
  assert.deepEqual(english.alternates?.languages, {
    en: "/help",
    de: "/de/hilfe",
    "x-default": "/help",
  });
  assert.equal(english.title, "Help");
  assert.equal(german.title, "Hilfe");
});

test("help route, navigation, and product copy stay discoverable", () => {
  const route = read("src/app/hilfe/page.tsx");
  const helpPage = read("src/components/marketing/help-page.tsx");
  const nav = read("src/components/marketing/marketing-nav.tsx");
  const footer = read("src/components/marketing/marketing-footer.tsx");
  const home = read("src/components/marketing/marketing-home.tsx");
  const developerDocs = read("src/components/marketing/developer-docs.tsx");

  assert.match(route, /src\/app\/hilfe|HelpPage/);
  assert.match(route, /route: "help"/);
  assert.match(route, /permanentRedirect\(getMarketingPath\("en", "help"\)\)/);
  assert.match(helpPage, /id="weekly-digest"/);
  assert.match(helpPage, /id="wordpress-releases"/);
  assert.match(helpPage, /Wochenrückblick/);
  assert.match(helpPage, /Wichtig/);
  assert.match(helpPage, /vertrauenswürdiges finales HTML/);
  assert.match(helpPage, /60-Sekunden-Fenster/);
  assert.match(helpPage, /Sobald Warteschlange und fälliges Ereignis gespeichert sind/);
  assert.match(helpPage, /dieser Anstoß aus/);
  assert.match(helpPage, /one non-blocking WP-Cron nudge per request/);
  assert.match(nav, /getMarketingPath\(locale, "help"\)/);
  assert.match(nav, /active === "help"/);
  assert.match(footer, /getMarketingPath\(locale, "help"\)/);
  assert.match(home, /data-testid="marketing-weekly-digest"/);
  assert.match(home, /getMarketingPath\(locale, "help"\)/);
  assert.match(developerDocs, /id="activity-digest"/);
  assert.match(developerDocs, /id="wordpress-releases"/);
  assert.match(developerDocs, /Sobald Warteschlange und Ereignis gespeichert sind/);
  assert.match(developerDocs, /dieser Anstoß aus/);
  assert.match(developerDocs, /one non-blocking WP-Cron nudge per request/);
});

test("help visual layout keeps digest and release content responsive", () => {
  const source = read("src/components/marketing/help-page.tsx");

  assert.match(source, /grid gap-4 sm:grid-cols-2 lg:grid-cols-4/);
  assert.match(source, /grid gap-4 md:grid-cols-2/);
  assert.match(source, /max-w-6xl px-5 py-16 sm:px-8/);
  assert.match(source, /\[overflow-wrap:anywhere\]/);
  assert.match(
    source,
    /data-testid="help-rate-limit-backoff"[\s\S]*?<h2 className="[^"]*\[overflow-wrap:anywhere\][^"]*"/,
  );
  assert.match(source, /aria-label=\{de \? "Hilfebereiche" : "Help sections"\}/);

  const navigationOrder = [
    'href="#weekly-digest"',
    'href="#wordpress-warmup"',
    'href="#text-safety"',
    'href="#rate-limit-backoff"',
    'href="#wordpress-releases"',
  ].map((marker) => source.indexOf(marker));
  const sectionOrder = [
    'id="weekly-digest"',
    'id="wordpress-warmup"',
    'id="text-safety"',
    'id="rate-limit-backoff"',
    'id="wordpress-releases"',
  ].map((marker) => source.indexOf(marker));

  assert.ok(navigationOrder.every((position) => position >= 0));
  assert.deepEqual([...navigationOrder].sort((left, right) => left - right), navigationOrder);
  assert.ok(sectionOrder.every((position) => position >= 0));
  assert.deepEqual([...sectionOrder].sort((left, right) => left - right), sectionOrder);
});
