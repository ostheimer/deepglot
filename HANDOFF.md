# Deepglot Handoff - 2026-05-12

This file captures the current project state so work can continue in a new chat without relying on previous conversation context.

## Current State

- Branch: `main`
- Latest production commit: `628d480` (`WP Nav-Menu-Integration, NavMenuSwitcher.php, Plugin v0.4.0 (#47)`)
- Open pull requests: none at the time this handoff was written.
- Canonical production URL: `https://deepglot.ai`
- Production validation WordPress site: `https://www.meinhaushalt.at`

## Completed In The Latest Session

- Fixed the public marketing navigation so the Deepglot logo links home.
- Restored the missing `WordPress Plugin` navigation item on the pricing page.
- Added public documentation/legal routes used by the marketing footer/navigation.
- Improved dashboard/sidebar link behavior and accessibility labels across visible controls.
- Added a broad Playwright UI audit that crawls known public and authenticated app routes, checks visible interactive labels, rejects nested interactives, and verifies app-owned internal links.
- Taught the UI audit to ignore customer-site runtime links when CI seeds the customer domain to the app host, such as translated URL paths and WordPress admin links.
- Merged PR `#26` into `main` and confirmed production deployment.

## Recent PRs (since original handoff):

- **PR #29-30:** Parallele Batch-Übersetzung (`Client::translateBatches()`)
- **PR #31:** JSON-LD / Schema.org Translation (`JsonLdTranslator.php`)
- **PR #32-33:** Billing Plans (BUSINESS, PRO, ADVANCED, EXTENDED tiers; `billing-plans.ts` als SSOT)
- **PR #34-36:** Pricing-Page mit interaktivem Slider
- **PR #37-38:** Stripe-Setup-Skript (`scripts/stripe-setup.ts`)
- **PR #40:** OpenAI-Modell auf `gpt-5.5` aktualisiert
- **PR #41:** Gemini Translation Provider (auf separatem Branch `claude/zealous-dirac-OkA7Z`, noch nicht auf main)
- **PR #42:** Accessibility-Attribute-Übersetzung (`img alt`, `aria-label`, `placeholder`, `input value`)
- **PR #44:** Admin UI für Language Switcher
- **PR #45:** Plugin Version 0.2.0
- **PR #46:** Weglot-Parity-Switcher, ARIA-expanded, `switcher.js` Progressive Enhancement
- **PR #47:** WP Nav-Menu-Integration, `NavMenuSwitcher.php`, Plugin v0.4.0

## Latest Verified Links

- `https://deepglot.ai/`
- `https://deepglot.ai/pricing`
- `https://www.deepglot.ai/api/public/status`
- `https://www.meinhaushalt.at/en/`
- `https://github.com/ostheimer/deepglot/pull/47`

## Verification Status

Latest already-completed checks:

- GitHub Actions `main` CI passed for commit `628d480`.
- Vercel Production deployment is ready.
- `npm run smoke:production` passed production smoke checks after the deployment.

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

- Stripe live/test billing acceptance remains postponed until real Stripe live/test keys, webhook secret, and monthly price IDs are intentionally configured.
- Phase 6 subdomain live QA remains blocked until a real mapped production host is configured through `DEEPGLOT_PHASE6_SUBDOMAIN_HOST`.

## Recommended Next Work

- Continue with the next roadmap phase only after selecting scope for Phase 8 or deciding to resume Stripe.
- Keep the test-first bug workflow from `AGENTS.md`: reproduce reported UI bugs with Playwright first, then fix and prove the fix.
- For future UI audits, prefer expanding `tests/e2e/full-ui-audit.spec.ts` rather than doing one-off manual checks.
- Review and merge the Gemini provider branch (`claude/zealous-dirac-OkA7Z`) when ready.
