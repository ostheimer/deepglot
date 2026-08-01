import assert from "node:assert/strict";
import test from "node:test";

import { buildEditorLaunchUrl } from "@/lib/editor-launch-url";

test("uses path-prefix fallback for an unmapped language in subdomain mode", () => {
  assert.equal(
    buildEditorLaunchUrl({
      domain: "example.com",
      routingMode: "SUBDOMAIN",
      domainMappings: [{ langCode: "en", host: "en.example.com" }],
      langTo: "fr",
      projectId: "project-1",
      token: "token-1",
    }),
    "https://example.com/fr?deepglot_editor=1&deepglot_editor_project=project-1&deepglot_editor_token=token-1",
  );
});

test("uses a mapped subdomain without adding a language prefix", () => {
  assert.equal(
    buildEditorLaunchUrl({
      domain: "example.com",
      routingMode: "SUBDOMAIN",
      domainMappings: [{ langCode: "en", host: "en.example.com" }],
      langTo: "en",
      projectId: "project-1",
      token: "token-1",
    }),
    "https://en.example.com/?deepglot_editor=1&deepglot_editor_project=project-1&deepglot_editor_token=token-1",
  );
});
