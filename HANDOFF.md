# Deepglot Handoff - 2026-05-16

This file captures the current project state so work can continue in a new chat without relying on previous conversation context.

## Current State

- Branch: `main`
- Latest production commit: `fb7d8b4` (`2026-05-16`)
- Open pull requests: none at the time this handoff was written.
- Open tracking items: 4 open issues in Phase 8: #56 (Checkout UI), #57 (Switcher parity), #58 (Strategic competitive gaps), #59 (Housekeeping). See ROADMAP.md Phase 8 for details.
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
- Completed Phase 8.5: Stripe Live Mode fully provisioned (acct_1GRyA0FAiA6nPZyW, EUR, webhook + restricted key, 5 products/10 prices, `acceptance:stripe --mode live` PASS).
- Completed Phase 8.6: Clean 2-dataset Neon topology — disconnected Vercel auto-branching, static `DEEPGLOT_DATABASE_URL` per scope, pruned branches to 2, Production unaffected.
- Completed Phase 8.7: WP plugin language-switcher v0.7.0 deployed to meinhaushalt.at with full ARIA, Gutenberg block, classic widget, nav-menu integration, and responsive-hide support.

## Latest Verified Links

- `https://deepglot.ai/`
- `https://deepglot.ai/pricing`
- `https://www.deepglot.ai/api/public/status`
- `https://www.meinhaushalt.at/en/`
- `https://github.com/ostheimer/deepglot/pull/26`

## Verification Status

Latest already-completed checks:

- GitHub Actions `main` CI passed for commit `fb7d8b4`.
- Vercel Production deployment is ready.
- `npm run smoke:production` passed `7/7` production smoke checks after the deployment.
- Phase 8.5 (Stripe Live provisioning): completed and verified via `acceptance:stripe --mode live`.
- Phase 8.6 (Neon 2-dataset topology): completed; Production on `prod` branch, Preview/Development on `main` branch.
- Phase 8.7 (WP plugin switcher v0.7.0): completed and deployed to meinhaushalt.at.

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

- Stripe Checkout UI (Issue #56) is not yet implemented: `/api/billing/checkout` is missing and `/(dashboard)/subscription` returns 404. Stripe Live is provisioned but users cannot subscribe via the UI.
- Phase 6 subdomain live QA remains blocked until a real mapped production host is configured through `DEEPGLOT_PHASE6_SUBDOMAIN_HOST`.

## Recommended Next Work

- Implement the Stripe Checkout flow (Issue #56) to unblock live revenue — see ROADMAP.md Phase 8.1.
- Continue with remaining Phase 8 items (#57, #58, #59) after #56 is resolved.
- Keep the test-first bug workflow from `AGENTS.md`: reproduce reported UI bugs with Playwright first, then fix and prove the fix.
- For future UI audits, prefer expanding `tests/e2e/full-ui-audit.spec.ts` rather than doing one-off manual checks.
