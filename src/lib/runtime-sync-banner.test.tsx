import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RuntimeSyncBanner } from "@/components/projekte/runtime-sync-banner";

test("shows the reported WordPress host without implying that the project domain changed", () => {
  const html = renderToStaticMarkup(
    <RuntimeSyncBanner
      locale="de"
      domain="www.meinhaushalt.at"
      runtimeSyncedAt={new Date("2026-09-15T08:00:00.000Z")}
      domainConflictHost="www.jobspot.at"
      domainConflictAt={new Date("2026-09-15T08:00:00.000Z")}
    />,
  );

  assert.match(html, /Domain-Konflikt erkannt/);
  assert.match(html, /www\.jobspot\.at/);
  assert.match(html, /www\.meinhaushalt\.at/);
  assert.match(html, /nicht geändert/);
  assert.match(html, /eigenes Projekt/);
});
