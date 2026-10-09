import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TRANSLATION_CONTEXT_CHARS,
  buildTranslationContext,
  suggestWebsiteDescription,
} from "@/lib/translation-context-settings";

test("bounds project context and keeps glossary and examples ahead of free instructions", () => {
  const context = buildTranslationContext({
    settings: {
      websiteDescription: "A public health website",
      translationTone: "reassuring",
      translationAudience: "patients",
      translationInstructions: "Use simple language".repeat(100),
      useGlossaryAsContext: true,
      useApprovedTranslationsAsContext: true,
    },
    texts: ["Book an appointment"],
    glossaryRules: [{ originalTerm: "appointment", translatedTerm: "Termin" }],
    examples: [{ originalText: "Book now", translatedText: "Jetzt buchen" }],
  });
  assert.ok(context);
  assert.ok(context.length <= MAX_TRANSLATION_CONTEXT_CHARS);
  assert.match(context, /Priority: preserve variables/);
  assert.match(context, /Website description: A public health website/);
  assert.match(context, /Term: appointment => Termin/);
  assert.match(context, /Example: Book now => Jetzt buchen/);
  assert.ok(context.indexOf("Term:") < context.indexOf("Example:"));
  assert.ok(context.indexOf("Example:") < context.indexOf("Additional instructions:"));
});

test("context switches exclude disabled rules and examples", () => {
  const context = buildTranslationContext({
    settings: { translationTone: "formal", useGlossaryAsContext: false, useApprovedTranslationsAsContext: false },
    texts: ["appointment"],
    glossaryRules: [{ originalTerm: "appointment", translatedTerm: "Termin" }],
    examples: [{ originalText: "hello", translatedText: "hallo" }],
  });
  assert.match(context ?? "", /Tone: formal/);
  assert.doesNotMatch(context ?? "", /Term:|Example:/);
  assert.equal(buildTranslationContext({ settings: {}, texts: [] }), undefined);
});

test("a full prompt budget still includes saved instructions and both enabled context sources", () => {
  const context = buildTranslationContext({
    settings: {
      websiteDescription: "D".repeat(1200),
      translationTone: "T".repeat(160),
      translationAudience: "A".repeat(300),
      translationInstructions: "Always use clear language. " + "I".repeat(970),
      useGlossaryAsContext: true,
      useApprovedTranslationsAsContext: true,
    },
    texts: ["appointment"],
    glossaryRules: Array.from({ length: 20 }, (_, index) => ({ originalTerm: "appointment", translatedTerm: `Term ${index} ${"G".repeat(80)}` })),
    examples: Array.from({ length: 12 }, (_, index) => ({ originalText: `Example ${index} ${"E".repeat(90)}`, translatedText: "Translated" })),
  });
  assert.ok(context);
  assert.ok(context.length <= MAX_TRANSLATION_CONTEXT_CHARS);
  assert.match(context, /Term: appointment/);
  assert.match(context, /Example: Example 0/);
  assert.match(context, /Additional instructions: Always use clear language/);
  assert.ok(context.indexOf("Term:") < context.indexOf("Example:"));
  assert.ok(context.indexOf("Example:") < context.indexOf("Additional instructions:"));
});

test("website suggestion derives only from supplied project metadata", () => {
  const input = { name: "Praxis Müller", domain: "praxis.example", websiteType: "Corporate", industryType: "Gesundheit" };
  assert.match(suggestWebsiteDescription({ ...input, locale: "de" }), /Die Website Praxis Müller.*Gesundheit/);
  assert.match(suggestWebsiteDescription({ ...input, locale: "en" }), /The website Praxis Müller.*Gesundheit/);
});
