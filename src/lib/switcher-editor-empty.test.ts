import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SwitcherEditor } from "@/components/projekte/switcher-editor";

test("missing WordPress switcher report keeps the WordPress editor reachable", () => {
  const html = renderToStaticMarkup(createElement(SwitcherEditor, {
    projectId: "fixture-project", locale: "de", initialOwner: "wordpress", initialRevision: 2,
    initialConfig: null, pluginSyncedAt: null, pluginRevision: null, conflict: false,
    languages: ["de", "en"], wpSettingsUrl: "https://fixture.example.test/wp-admin/options-general.php?page=deepglot",
  }));
  assert.match(html, /Die WordPress-Einstellungen für die Sprachauswahl wurden noch nicht abgeglichen/);
  assert.match(html, /href="https:\/\/fixture\.example\.test\/wp-admin\/options-general\.php\?page=deepglot"/);
  assert.match(html, /WordPress-Editor für Sprachauswahl öffnen/);
});

test("missing WordPress switcher report omits the link for an invalid project domain", () => {
  const html = renderToStaticMarkup(createElement(SwitcherEditor, {
    projectId: "fixture-project", locale: "de", initialOwner: "wordpress", initialRevision: 0,
    initialConfig: null, pluginSyncedAt: null, pluginRevision: null, conflict: false,
    languages: ["de", "en"], wpSettingsUrl: null,
  }));
  assert.match(html, /Die WordPress-Einstellungen für die Sprachauswahl wurden noch nicht abgeglichen/);
  assert.doesNotMatch(html, /href=/);
});
