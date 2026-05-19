# Deepglot Handoff - 2026-05-17

This file captures the current project state so work can continue in a new chat without relying on previous conversation context.

## Current State

- Branch: `main`
- Latest production commit: `df088bf` (`Localize remaining metadata (#66)`)
- Open pull requests: verify the current state with `gh pr list --repo ostheimer/deepglot --state open`; documentation sync PRs may be open independently of production state.
- Canonical production URL: `https://deepglot.ai`
- Production validation WordPress site: `https://www.meinhaushalt.at`

## Completed In The Latest Session (since 2026-05-06)

- **Stripe Checkout end-to-end** (PRs #56, #61, 2026-05-17): Logged-in users can now subscribe. `POST /api/billing/checkout` implemented; `/(dashboard)/subscription` pages (`/abonnement/uebersicht`, `/abonnement/nutzung`, `/abonnement/karte-rechnungen`) are live. Pricing CTAs route to the checkout flow instead of `/signup`.
- **EU-wide localization** (PR #62, 2026-05-17): Extended locale support beyond EN/DE to additional EU language codes. Public routes, auth, and dashboard routes all serve localized variants.
- **Localized route round-trip regression test** (commit `a9022fb`, 2026-05-17): New Playwright test ensures localized routes correctly round-trip across all supported locales.
- **Fix localized marketing pricing units** (PR #65, 2026-05-17): Pricing hero claims on localized routes are now sourced from `BILLING_PLANS`, not hardcoded strings. Closes a silent drift risk for the Pro tier price/word-ceiling across locales.
- **Localize remaining metadata** (PR #66, 2026-05-17): All `<head>` metadata (title, description, OG tags) rendered in the request locale.
- **Plugin v0.7.0 — per-language custom flag override** (PR #53, 2026-05-14): Each language in the switcher can now use a custom flag image instead of the default emoji/CDN flag.
- **Plugin v0.6.0 — responsive hide** (PR #52, 2026-05-14): Switcher can be shown only on desktop or only on mobile via a new toggle.
- **Switcher aria-expanded bug fix** (PR #51, 0.5.2, 2026-05-14): `aria-expanded` attribute is now only added when the dropdown variant is active.
- **Switcher active-language + skip-plugin-link bugs** (PR #50, 0.5.1, 2026-05-13): Active language now highlighted correctly under stripped `REQUEST_URI`; `LinkRewriter` no longer rewrites the switcher's own `href` attributes.

## Latest Verified Links

- `https://deepglot.ai/`
- `https://deepglot.ai/pricing`
- `https://www.deepglot.ai/api/public/status`
- `https://www.meinhaushalt.at/en/`

## Verification Status

Latest already-completed checks:

- GitHub Actions `main` CI passed for commit `df088bf`.
- Vercel Production deployment is ready.
- `npm run acceptance:stripe --mode live` PASS.

Run these before starting a new larger implementation branch:

```bash
npm run check:docs-language
npm test
npm run test:wp
npm run lint
npx tsc --noEmit --pretty false
npm run build
npm run smoke:production
```

Run Playwright when UI behavior changes:

```bash
npm run test:e2e
```

## Known External Blocks

- Phase 6 subdomain live QA remains blocked until a real mapped production host is configured through `DEEPGLOT_PHASE6_SUBDOMAIN_HOST`.

## Open Roadmap Items

- **8.2** Switcher Weglot-parity: multi-switcher instances, visual switcher editor, pre-made templates (P2).
- **8.3** Strategic Weglot competitive gaps: in-context visual translation editor, translation memory, glossary dashboard UI, PDF translation, multilingual sitemap, AMP verification, translation CDN (P3).
- **8.4** Housekeeping: dead `DATABASE_*` env vars and stale `AccessibilityAttributeTranslationTest 2.php` (P4).
- **7.13** Anti-drift guard for marketing copy (`marketing-home.test.ts`).
- **7.14** Playwright slider-alignment regression test for `pricing-grid.tsx`.
- **7.15** Stripe webhook end-to-end smoke for subscription-lifecycle events.

## Recommended Next Work

- Continue with Phase 8.2/8.3 (Weglot competitive parity) or 8.4 (Housekeeping).
- Keep the test-first bug workflow from `AGENTS.md`: reproduce reported UI bugs with Playwright first, then fix and prove the fix.
- For future UI audits, prefer expanding `tests/e2e/full-ui-audit.spec.ts` rather than doing one-off manual checks.
