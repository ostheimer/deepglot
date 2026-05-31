# Deepglot Handoff - 2026-05-31

This file captures the current project state so work can continue in a new chat without relying on previous conversation context.

## Current State

- Branch: `main`
- Latest production commit: `414de73` (`Add regression test for Languages-page management gating (#109)`)
- Open pull requests: verify the current state with `gh pr list --repo ostheimer/deepglot --state open`; documentation sync PRs may be open independently of production state.
- Canonical production URL: `https://deepglot.ai`
- Production validation WordPress site: `https://www.meinhaushalt.at`

## Completed In The Latest Session (since 2026-05-06)

### Security Hardening (2026-05-27 – 2026-05-30)

- **Regression test for Languages-page management gating** (PR #109, 2026-05-30): Source-level guardrail asserting `AddLanguageDialog` renders only for managers; prevents silent regressions of the auth gate added in PR #103.
- **Block new Checkout when org already has live subscription** (PR #108, 2026-05-30): `POST /api/billing/checkout` now returns HTTP 409 when the org already has an ACTIVE or TRIALING subscription, directing to the billing portal instead. Prevents double-billing.
- **Require management to add/remove project languages** (PR #103, 2026-05-30): IDOR fix — `DELETE /api/projects/[id]/languages` had no authorization at all; `POST` gated only on org membership. Both now require `userCanManageProject`. Language code validated via Zod.
- **Hide language add control from non-managers on Languages page** (PR #106, 2026-05-30): UI control for adding languages now only visible to managers, mirroring the API gate from PR #103.
- **Settings UX improvements** (PR #104, 2026-05-30): Visual editor launcher now only offers active target languages within the user's access scope; webhook URL field shows a public-HTTPS hint matching the SSRF guard.
- **Block SSRF in webhook delivery** (PR #100, 2026-05-29): New `src/lib/webhook-url-safety.ts` classifies private/reserved IPv4+IPv6 ranges and internal hostnames. Enforced at create/update (400) AND at dispatch (re-checks resolved IPs to defeat DNS rebinding). Redirects disabled. Response body capped at 512 chars to limit read-back.
- **Harden visual-editor session tokens** (PR #98, 2026-05-29): Language scope bound into the token; `langTo` enforced in `/manual-translations` (language-scoped translator cannot edit other languages). Rate limiting per project on the manual-translations write path.
- **Harden project import/export** (PR #96, 2026-05-29): `MAX_IMPORT_ROWS` cap; chunked writes (one short transaction per chunk); CSV/formula injection protection (CWE-1236) via leading apostrophe; per-language scope for translators; usage attributed per language pair; PO export filename sanitized.
- **Require management for settings-area API routes** (PR #95, 2026-05-29): IDOR fix — project DELETE/PATCH and api-key create/revoke checked only org membership; webhooks and exclusions routes used the weaker `userHasProjectAccess`. All switched to `userCanManageProject`. Source-level guardrail test added.
- **Fix tsc failure on Stripe webhook test mock** (PR #97, 2026-05-29): Type-correct mock arguments so `tsc --noEmit` passes on the test files.
- **Add full tsc --noEmit typecheck to CI** (PR #99, 2026-05-29): New `typecheck` npm script; runs as a dedicated CI step after install so type errors outside the Next.js build graph are caught.
- **Guard Stripe customer API calls** (PR #92, 2026-05-30): All Stripe customer API calls use `isRealStripeCustomerId()` to avoid hitting the Stripe API with placeholder IDs.
- **isRealStripeCustomerId() centralization** (PR #89, 2026-05-27): `manual_<orgId>` placeholder was not excluded by the existing `free_`-only check, causing Stripe 404s for ENTERPRISE orgs. Centralized as `isRealStripeCustomerId()` (allowlist `cus_…` pattern); adopted across three call sites.

### Feature Work (2026-05-17)

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

- GitHub Actions `main` CI passed for commit `414de73`.
- Vercel Production deployment is ready.
- `npm run acceptance:stripe --mode live` PASS.

Run these before starting a new larger implementation branch:

```bash
npm run check:docs-language
npm run typecheck
npm test
npm run test:wp
npm run lint
npm run build
npm run smoke:production
```

Run Playwright when UI behavior changes:

```bash
npm run test:e2e
```

## Known External Blocks

- Phase 6 subdomain live QA remains blocked until a real mapped production host is configured through `DEEPGLOT_PHASE6_SUBDOMAIN_HOST`.
- Visual editor token still passed in the launch URL (`?deepglot_editor_token`); moving it out of the URL requires a coordinated WordPress-plugin change (noted in PR #98).

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
