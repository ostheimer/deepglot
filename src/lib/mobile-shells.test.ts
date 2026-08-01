import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

test("dashboard shell provides a mobile drawer without exposing the desktop sidebar", () => {
  const sidebar = source("src", "components", "dashboard", "sidebar.tsx");
  const layout = source("src", "app", "(dashboard)", "layout.tsx");

  assert.match(sidebar, /data-testid="dashboard-mobile-nav-trigger"/);
  assert.match(sidebar, /className="[^"]*lg:hidden[^"]*"/);
  assert.match(sidebar, /data-testid="dashboard-desktop-sidebar"/);
  assert.match(sidebar, /className="[^"]*hidden[^"]*lg:flex[^"]*"/);
  assert.ok(
    (sidebar.match(/<SheetClose asChild/g) ?? []).length >= 2,
    "the mobile logo and navigation links must close the dashboard drawer"
  );
  assert.match(layout, /className="[^"]*flex-col[^"]*lg:flex-row[^"]*"/);
});

test("project shell stacks on mobile and closes its drawer after navigation", () => {
  const sidebar = source("src", "components", "projekte", "project-sidebar.tsx");
  const layout = source(
    "src",
    "app",
    "(dashboard)",
    "projekte",
    "[projektId]",
    "layout.tsx"
  );

  assert.match(sidebar, /data-testid="project-mobile-nav-trigger"/);
  assert.match(sidebar, /data-testid="project-desktop-sidebar"/);
  assert.match(sidebar, /className="[^"]*hidden[^"]*lg:flex[^"]*"/);
  assert.ok(
    (sidebar.match(/<SheetClose asChild/g) ?? []).length >= 2,
    "the back link and project links must close the project drawer"
  );
  assert.match(layout, /className="[^"]*lg:flex[^"]*lg:gap-6[^"]*"/);
  assert.doesNotMatch(layout, /className="flex gap-6 -m-8 min-h-screen"/);
});

test("billing shell uses a horizontally scrollable mobile nav and a desktop sidebar", () => {
  const nav = source("src", "components", "abonnement", "billing-sidebar-nav.tsx");
  const layout = source("src", "app", "(dashboard)", "abonnement", "layout.tsx");

  assert.match(nav, /data-testid="billing-section-nav"/);
  assert.match(nav, /className="[^"]*overflow-x-auto[^"]*lg:block[^"]*"/);
  assert.match(layout, /className="[^"]*flex-col[^"]*lg:flex-row[^"]*"/);
  assert.match(layout, /className="[^"]*w-full[^"]*lg:w-52[^"]*"/);
});
