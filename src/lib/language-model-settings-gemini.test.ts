import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageModelSettingsCard } from "../components/projekte/language-model-settings-card";

for (const locale of ["de", "en"] as const) {
  test(`Gemini project settings expose the persisted model in ${locale}`, () => {
    const html = renderToStaticMarkup(createElement(LanguageModelSettingsCard, {
      projectId: "omnimed-test",
      locale,
      initialSettings: {
        provider: "gemini", model: "gemini-3.1-flash-lite",
        baseUrl: null, hasProjectApiKey: false,
      },
      initialEffective: {
        provider: "gemini", providerLabel: "Google Gemini",
        model: "gemini-3.1-flash-lite", baseUrl: null, hasApiKey: true,
      },
      providers: [{
        id: "gemini", label: "Google Gemini",
        recommendedModels: ["gemini-3.1-flash-lite"],
      }],
    }));
    assert.match(html, /<input[^>]*id="translationModel"[^>]*value="gemini-3\.1-flash-lite"/);
    assert.ok(html.includes(locale === "de"
      ? "Google-Gemini-Modelle für automatische Übersetzungen."
      : "Google Gemini models for automatic translations."));
  });
}
